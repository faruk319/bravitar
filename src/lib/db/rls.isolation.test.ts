import { sql as q } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDatabaseSafety } from "@/lib/db/assert-safe";
import { db, sql as runtimeSql } from "@/lib/db/client";
import { auditLog } from "@/lib/db/audit";
import { readAppCatalog } from "@/lib/db/isolation/catalog";
import { fixtures, PLATFORM_TABLES } from "@/lib/db/isolation/registry";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { withTenant } from "@/lib/db/with-tenant";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { platformPlans } from "@/modules/platform/schema";
import { createTenant } from "@/modules/tenancy/repo";
import { tenants } from "@/modules/tenancy/schema";

// Tenant-leak suite. Reads the live catalog so every table in `app` is checked
// whether or not anyone remembered it. Runs as app_runtime through DATABASE_URL
// (the pooler locally), which is the only way it proves anything.

const catalog = await readAppCatalog(runtimeSql);
const tenantScoped = catalog.filter((t) => t.hasTenantId);
const platformTables = catalog.filter((t) => !t.hasTenantId);

const TENANT_EXPR = /tenant_id = .*current_setting\('app\.tenant_id'/;
const RLS_VIOLATION = "42501";

function sqlState(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

async function countAs(tenantId: string | null, table: string): Promise<number> {
  const query = q`SELECT count(*)::int AS n FROM app.${q.identifier(table)}`;
  const rows = tenantId === null ? await db.execute<{ n: number }>(query) : await withTenant(tenantId, (tx) => tx.execute<{ n: number }>(query));
  return rows[0]?.n ?? -1;
}

let A = "";
let B = "";
let slugA = "";

beforeAll(async () => {
  const stamp = Math.random().toString(36).slice(2, 8);
  slugA = `iso-a-${stamp}`;
  [A, B] = await withPlatformAdmin({ action: "test.isolation.setup", actorType: "system" }, async (tx) => {
    await ensurePlatformPlans(tx);
    const a = await createTenant(tx, { name: `Isolation A ${stamp}`, slug: slugA, verticalPreset: "karate" });
    const b = await createTenant(tx, { name: `Isolation B ${stamp}`, slug: `iso-b-${stamp}` });
    return [a.id, b.id];
  });
});

afterAll(async () => {
  await deleteTenantsCompletely([A, B]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("catalog", () => {
  it("has at least one tenant-scoped table and one fixture (a vacuous pass is a failure)", () => {
    expect(tenantScoped.length).toBeGreaterThan(0);
    expect(Object.keys(fixtures).length).toBeGreaterThan(0);
  });

  it.each(platformTables)("app.$table has no tenant_id and is allow-listed with a reason", (t) => {
    expect(PLATFORM_TABLES[t.table], `app.${t.table} has no tenant_id column and no entry in PLATFORM_TABLES`).toBeTypeOf("string");
  });

  it.each(tenantScoped)("app.$table has an isolation fixture", (t) => {
    expect(fixtures[t.table], `add a fixture for app.${t.table} in src/modules/<module>/isolation.ts`).toBeTypeOf("function");
  });

  it.each(tenantScoped)("app.$table has RLS enabled, forced, and tenant_isolation for app_runtime", (t) => {
    expect(t.rlsEnabled, "ENABLE ROW LEVEL SECURITY").toBe(true);
    expect(t.rlsForced, "FORCE ROW LEVEL SECURITY").toBe(true);
    const p = t.policies.find((x) => x.policyname === "tenant_isolation");
    expect(p, "policy tenant_isolation").toBeDefined();
    expect(p?.roles).toEqual(["app_runtime"]);
    expect(p?.cmd).toBe("ALL");
    expect(p?.qual).toMatch(TENANT_EXPR);
    expect(p?.with_check).toMatch(TENANT_EXPR);
  });

  it("app.tenants is forced and limited to the tenant's own row", () => {
    const t = catalog.find((x) => x.table === "tenants");
    expect(t?.rlsEnabled).toBe(true);
    expect(t?.rlsForced).toBe(true);
    const p = t?.policies.find((x) => x.policyname === "tenant_self");
    expect(p?.roles).toEqual(["app_runtime"]);
    expect(p?.qual).toMatch(/id = .*current_setting\('app\.tenant_id'/);
    expect(p?.with_check).toMatch(/id = .*current_setting\('app\.tenant_id'/);
  });
});

describe("connection roles", () => {
  it("runtime role cannot bypass RLS and owns nothing; platform role is exempt", async () => {
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });
});

describe("withTenant", () => {
  it("rejects a non-uuid or empty tenant id before touching the database", async () => {
    await expect(withTenant("not-a-uuid", async () => 1)).rejects.toThrow();
    await expect(withTenant("", async () => 1)).rejects.toThrow();
  });

  it("sees exactly its own tenant row", async () => {
    const rows = await withTenant(A, (tx) => tx.select({ id: tenants.id }).from(tenants));
    expect(rows.map((r) => r.id)).toEqual([A]);
  });

  it("sees no tenant rows without a context", async () => {
    expect(await db.select({ id: tenants.id }).from(tenants)).toEqual([]);
  });

  it("cannot insert a tenant row that is not itself", async () => {
    const attempt = withTenant(A, (tx) => tx.insert(tenants).values({ name: "smuggled", slug: `smuggled-${A.slice(0, 8)}` }));
    await expect(attempt).rejects.toSatisfy((e) => sqlState(e) === RLS_VIOLATION);
  });

  it("leaves no context behind on the pool after the transaction ends", async () => {
    await withTenant(A, async (tx) => {
      const [row] = await tx.execute<{ v: string }>(q`SELECT current_setting('app.tenant_id', true) AS v`);
      expect(row?.v).toBe(A);
    });
    for (let i = 0; i < 5; i++) {
      const [row] = await db.execute<{ v: string | null }>(q`SELECT NULLIF(current_setting('app.tenant_id', true), '') AS v`);
      expect(row?.v).toBeNull();
    }
    expect(await countAs(null, "tenants")).toBe(0);
  });
});

describe.each(tenantScoped)("isolation of app.$table", (t) => {
  const fixture = fixtures[t.table];
  if (!fixture) throw new Error(`no fixture for app.${t.table}`);

  beforeAll(async () => {
    await withTenant(A, (tx) => fixture(tx, A));
  });

  it("tenant A sees its own rows", async () => {
    expect(await countAs(A, t.table)).toBeGreaterThan(0);
  });

  it("tenant B sees none of A's rows", async () => {
    expect(await countAs(B, t.table)).toBe(0);
  });

  it("no context sees nothing", async () => {
    expect(await countAs(null, t.table)).toBe(0);
  });

  it("tenant B cannot insert a row carrying A's tenant_id", async () => {
    await expect(withTenant(B, (tx) => fixture(tx, A))).rejects.toSatisfy((e) => sqlState(e) === RLS_VIOLATION);
  });

  it("tenant B cannot update or delete A's rows (0 rows affected, or refused outright)", async () => {
    // Append-only tables revoke UPDATE/DELETE entirely; either outcome is a non-leak.
    const affected = async (stmt: ReturnType<typeof q>) =>
      withTenant(B, (tx) => tx.execute(stmt)).then((r) => r.count, (e: unknown) => (sqlState(e) === RLS_VIOLATION ? 0 : Promise.reject(e)));
    expect(await affected(q`UPDATE app.${q.identifier(t.table)} SET tenant_id = tenant_id WHERE tenant_id = ${A}`)).toBe(0);
    expect(await affected(q`DELETE FROM app.${q.identifier(t.table)} WHERE tenant_id = ${A}`)).toBe(0);
    expect(await countAs(A, t.table)).toBeGreaterThan(0);
  });

  it("tenant A cannot move its rows to tenant B", async () => {
    const attempt = withTenant(A, (tx) => tx.execute(q`UPDATE app.${q.identifier(t.table)} SET tenant_id = ${B} WHERE tenant_id = ${A}`));
    await expect(attempt).rejects.toSatisfy((e) => sqlState(e) === RLS_VIOLATION);
  });

  it("20 interleaved transactions through the pool each see only their own tenant", async () => {
    await withTenant(B, (tx) => fixture(tx, B));
    const ids = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? A : B));
    const results = await Promise.all(
      ids.map((id) =>
        withTenant(id, async (tx) => {
          await tx.execute(q`SELECT pg_sleep(0.01)`);
          const rows = await tx.execute<{ tenant_id: string }>(q`SELECT tenant_id FROM app.${q.identifier(t.table)}`);
          return { id, own: rows.filter((r) => r.tenant_id === id).length, foreign: rows.filter((r) => r.tenant_id !== id).length };
        }),
      ),
    );
    for (const r of results) {
      expect(r.foreign, `tenant ${r.id} saw foreign rows`).toBe(0);
      expect(r.own).toBeGreaterThan(0);
    }
  });
});

describe("append-only audit_log", () => {
  it("refuses UPDATE and DELETE for the runtime role even on its own rows", async () => {
    await withTenant(A, (tx) => tx.insert(auditLog).values({ tenantId: A, actorType: "system", action: "test.append_only" }));
    await expect(withTenant(A, (tx) => tx.update(auditLog).set({ action: "tampered" }))).rejects.toSatisfy((e) => sqlState(e) === RLS_VIOLATION);
    await expect(withTenant(A, (tx) => tx.delete(auditLog))).rejects.toSatisfy((e) => sqlState(e) === RLS_VIOLATION);
  });

  it("refuses UPDATE and DELETE for the platform role too", async () => {
    await expect(platformDb.update(auditLog).set({ action: "tampered" })).rejects.toSatisfy((e) => sqlState(e) === RLS_VIOLATION);
    await expect(platformDb.delete(auditLog)).rejects.toSatisfy((e) => sqlState(e) === RLS_VIOLATION);
  });

  it("cannot write a row for another tenant", async () => {
    await expect(withTenant(B, (tx) => tx.insert(auditLog).values({ tenantId: A, actorType: "system", action: "test.smuggle" }))).rejects.toSatisfy(
      (e) => sqlState(e) === RLS_VIOLATION,
    );
  });
});

describe("platform_plans", () => {
  it("is readable by tenants but not writable", async () => {
    const plans = await withTenant(A, (tx) => tx.select({ code: platformPlans.code }).from(platformPlans));
    expect(plans.map((p) => p.code)).toContain("starter");
    await expect(withTenant(A, (tx) => tx.insert(platformPlans).values({ code: "free", name: "Free", pricePaise: 0n, billingCycle: "monthly" }))).rejects.toSatisfy(
      (e) => sqlState(e) === RLS_VIOLATION,
    );
  });
});

describe("resolve_tenant_slug", () => {
  it("returns one tenant's public fields without any context", async () => {
    const found = await resolveTenantBySlug(slugA);
    expect(found).toMatchObject({ id: A, slug: slugA, status: "active", verticalPreset: "karate" });
    expect(found && "enabledModules" in found).toBe(false);
  });

  it("returns nothing for an unknown slug, and app.tenants stays unreadable", async () => {
    expect(await resolveTenantBySlug("no-such-academy")).toBeUndefined();
    expect(await db.select({ id: tenants.id }).from(tenants)).toEqual([]);
  });
});
