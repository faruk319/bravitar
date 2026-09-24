import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { fakeRazorpay } from "./fake-razorpay";
import { tenantIntegrations } from "./schema";
import { connectRazorpay, razorpayConnected, razorpayKeys, razorpayStatus, testRazorpay } from "./service";

// docs/04 test list, Razorpay: the academy's own keys, sealed, checked first.

const stamp = Math.random().toString(36).slice(2, 8);
const made: string[] = [];
const KEYS = { keyId: "rzp_test_AbCdEf123456", keySecret: "secret-ok", webhookSecret: "whsec-academy-a" };
let A = "";
let B = "";
let ownerA: ScopedCtx;
let ownerB: ScopedCtx;
let managerA: ScopedCtx;

const academy = async (key: string) => {
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Razorpay ${key} ${stamp}`, slug: `rzp-${key}-${stamp}`, owner: { name: "Owner", email: `rzp-${key}-${stamp}@example.test` } });
  made.push(t.tenant.id);
  return t;
};
const ctxFor = async (T: string, staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const [a, b] = [await academy("a"), await academy("b")];
  [A, B] = [a.tenant.id, b.tenant.id];
  ownerA = await ctxFor(A, a.owner.id);
  ownerB = await ctxFor(B, b.owner.id);
  const roles = Object.fromEntries((await withTenant(A, listRoles)).map((r) => [r.name, r.id]));
  const m = await withTenant(A, (tx) => createStaffMember(tx, ownerA, { email: `rzp-manager-${stamp}@example.test`, fullName: "Manager", roleIds: [roles.Manager ?? ""] }));
  managerA = await ctxFor(A, m.id);
});

afterAll(async () => {
  await deleteTenantsCompletely(made);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("connecting Razorpay", () => {
  it("checks the keys with Razorpay first and refuses what it refuses", async () => {
    const rzp = fakeRazorpay();
    await expect(withTenant(A, (tx) => connectRazorpay(tx, ownerA, { ...KEYS, keySecret: "wrong-secret" }, { api: rzp.api }))).rejects.toThrow("didn't accept these keys");
    rzp.down = true;
    await expect(withTenant(A, (tx) => connectRazorpay(tx, ownerA, KEYS, { api: rzp.api }))).rejects.toThrow("Couldn't reach Razorpay");
    await expect(withTenant(A, (tx) => connectRazorpay(tx, ownerA, { ...KEYS, keyId: "key_123" }, { api: rzp.api }))).rejects.toThrow();
    expect(await withTenant(A, razorpayConnected)).toBe(false);
  });

  it("seals the secrets: none of them is in the row, the status or the audit log", async () => {
    const rzp = fakeRazorpay();
    const status = await withTenant(A, (tx) => connectRazorpay(tx, ownerA, KEYS, { api: rzp.api }));
    expect(status).toMatchObject({ connected: true, keyId: KEYS.keyId, mode: "test", lastError: null });
    expect(JSON.stringify(status)).not.toContain(KEYS.keySecret);
    const [row] = await withTenant(A, (tx) => tx.select().from(tenantIntegrations).where(eq(tenantIntegrations.tenantId, A)));
    const stored = `${row?.credentials.toString("latin1")}${JSON.stringify(row?.config)}`;
    for (const secret of [KEYS.keySecret, KEYS.webhookSecret]) expect(stored).not.toContain(secret);
    const audit = await withTenant(A, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, row?.id ?? "")));
    expect(audit.map((x) => x.action)).toEqual(["integration.connect"]);
    expect(JSON.stringify(audit)).not.toContain(KEYS.keySecret);
    expect(await withTenant(A, (tx) => razorpayKeys(tx))).toEqual(KEYS);
  });

  it("saving again replaces the keys, audited as an update", async () => {
    const rzp = fakeRazorpay("secret-two");
    await withTenant(A, (tx) => connectRazorpay(tx, ownerA, { ...KEYS, keyId: "rzp_live_XyZ987654321", keySecret: "secret-two" }, { api: rzp.api }));
    expect(await withTenant(A, (tx) => razorpayKeys(tx))).toMatchObject({ keyId: "rzp_live_XyZ987654321", keySecret: "secret-two" });
    expect((await withTenant(A, (tx) => razorpayStatus(tx, ownerA))).mode).toBe("live");
    const actions = (await withTenant(A, (tx) => tx.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityType, "integration")))).map((x) => x.a).sort();
    expect(actions).toEqual(["integration.connect", "integration.update"]);
  });

  it("test connection records what Razorpay says", async () => {
    const rzp = fakeRazorpay("secret-two");
    rzp.down = true;
    expect((await withTenant(A, (tx) => testRazorpay(tx, ownerA, { api: rzp.api }))).lastError).toMatch("Couldn't reach Razorpay");
    rzp.down = false;
    expect((await withTenant(A, (tx) => testRazorpay(tx, ownerA, { api: rzp.api }))).lastError).toBeNull();
  });

  it("needs integrations:manage: a manager can't see or change it", async () => {
    await expect(withTenant(A, (tx) => connectRazorpay(tx, managerA, KEYS, { api: fakeRazorpay().api }))).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(A, (tx) => razorpayStatus(tx, managerA))).rejects.toMatchObject({ status: 403 });
  });
});

describe("whose keys", () => {
  it("an academy without its own connection has none: nothing falls back", async () => {
    expect(await withTenant(B, (tx) => razorpayKeys(tx))).toBeUndefined();
    expect(await withTenant(B, razorpayConnected)).toBe(false);
  });

  it("academy A's sealed keys copied onto academy B's row don't open", async () => {
    const [row] = await withTenant(A, (tx) => tx.select().from(tenantIntegrations));
    await withTenant(B, (tx) => tx.insert(tenantIntegrations).values({ id: uuidv7(), tenantId: B, kind: "razorpay", credentials: row?.credentials ?? Buffer.alloc(0), config: row?.config ?? {} }));
    await expect(withTenant(B, (tx) => razorpayKeys(tx))).rejects.toThrow("does not open");
    expect((await withTenant(B, (tx) => razorpayStatus(tx, ownerB))).connected).toBe(true); // the row exists, but it's useless to B
  });
});
