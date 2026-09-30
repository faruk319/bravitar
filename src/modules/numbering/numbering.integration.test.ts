import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { todayIn } from "@/lib/dates";
import { financialYear } from "@/lib/money/fy";
import { tenants } from "@/modules/tenancy/schema";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { runOpenYear } from "./job";
import { allocateNumber } from "./repo";
import { numberSeries } from "./schema";

const stamp = Math.random().toString(36).slice(2, 8);
const made: string[] = [];
const tenant = async (key: string) => {
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Numbers ${key} ${stamp}`, slug: `num-${key}-${stamp}`, owner: { name: "Owner", email: `num-${key}-${stamp}@example.test` } });
  made.push(t.tenant.id);
  return t.tenant.id;
};
const series = (T: string) => withTenant(T, (tx) => tx.select().from(numberSeries).where(eq(numberSeries.tenantId, T)));
let T = "";

beforeAll(async () => {
  T = await tenant("a");
});

afterAll(async () => {
  await deleteTenantsCompletely(made);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("number series", () => {
  it("a new academy starts with this year's invoice and receipt series", async () => {
    const fy = financialYear(todayIn("Asia/Kolkata"));
    expect((await series(T)).map((s) => [s.kind, s.fy, s.prefix, s.nextValue]).sort()).toEqual([
      ["invoice", fy, `INV/${fy}/`, 1],
      ["receipt", fy, `RCT/${fy}/`, 1],
    ]);
  });

  it("20 transactions issuing at once get 0001–0020, no duplicate, no gap", async () => {
    const numbers = await Promise.all(Array.from({ length: 20 }, () => withTenant(T, (tx) => allocateNumber(tx, T, "invoice", "2030-31"))));
    expect(numbers.sort()).toEqual(Array.from({ length: 20 }, (_, i) => `INV/2030-31/${String(i + 1).padStart(4, "0")}`));
  });

  it("a rolled-back issue gives its number back", async () => {
    await withTenant(T, async (tx) => {
      expect(await allocateNumber(tx, T, "receipt", "2030-31")).toBe("RCT/2030-31/0001");
      throw new Error("payment failed");
    }).catch(() => {});
    expect(await withTenant(T, (tx) => allocateNumber(tx, T, "receipt", "2030-31"))).toBe("RCT/2030-31/0001");
  });

  it("each financial year starts again at 0001", async () => {
    expect(await withTenant(T, (tx) => allocateNumber(tx, T, "invoice", "2031-32"))).toBe("INV/2031-32/0001");
  });
});

describe("the new-year job", () => {
  it("opens the year for every academy, twice without harm; one broken academy doesn't stop the rest", async () => {
    const [b, broken] = [await tenant("b"), await tenant("broken")];
    await withPlatformAdmin({ action: "test.break_timezone", actorType: "system" }, (tx) => tx.update(tenants).set({ timezone: "Mars/Olympus" }).where(eq(tenants.id, broken)));
    const firstApril = new Date("2027-03-31T18:35:00Z"); // 00:05 IST, 1 April 2027
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = await runOpenYear({ now: firstApril, tenantIds: [T, b, broken] });
    await runOpenYear({ now: firstApril, tenantIds: [T, b] });
    err.mockRestore();
    expect([run.tenants, run.ok, run.failed.map((f) => f.tenantId)]).toEqual([3, 2, [broken]]);
    for (const id of [T, b]) expect((await series(id)).filter((s) => s.fy === "2027-28").map((s) => [s.kind, s.nextValue]).sort()).toEqual([["invoice", 1], ["receipt", 1]]);
  });
});
