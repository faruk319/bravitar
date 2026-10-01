import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addTestActivities, removeTestActivities, testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { percent } from "@/lib/money/paise";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { addStaff, loadAccessContext } from "@/modules/staff/service";
import { createBranch } from "@/modules/tenancy/repo";
import { billingPage, billPage } from "./owner";
import { payToStart } from "./payments";
import { getBillingSettings, listInvoices } from "./repo";
import { activityPlans } from "./schema";
import { renewSubscription, startActivity } from "./service";

// The academy's own Billing page (agreed 2026-09-30): read through its own
// transaction, so it sees its own modules, bills and payments only.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `test-own-${stamp}` as const;
const ids = { paid: "", waiting: "", otherBill: "" };
let planId = "";
let A = "";
let B = "";
let owner: ScopedCtx;
let teacher: ScopedCtx;
let price = 0n; // the plan's price with tax

const ctxFor = async (tenantId: string, staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(tenantId, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const start = (tenantId: string, name: string, on: string) =>
  withPlatformAdmin({ action: "test.owner.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId, name });
    return startActivity(tx, { tenantId, branchId: branch.id, activityKey: KEY, planId, today: on, trial: false });
  });
// Paid on 10 Jan; February's bill is still open.
const paidThenOwing = async (tenantId: string, name: string) => {
  const s = await start(tenantId, name, "2026-01-10");
  await payToStart(ME, s.id, { now: new Date("2026-01-10T12:00:00+05:30") });
  await renewSubscription(s.id, "2026-02-10");
  return s.id;
};

beforeAll(async () => {
  const tax = (await platformRead(getBillingSettings)).taxRateBp;
  price = 50_000n + percent(50_000n, tax);
  await addTestActivities([{ key: KEY, name: "Test own" }]);
  planId = uuidv7();
  await platformDb.insert(activityPlans).values({ id: planId, activityKey: KEY, name: "Monthly", pricePaise: 50_000n, isOffered: false });

  const a = await testAcademy({ name: `Own ${stamp}`, slug: `own-a-${stamp}`, owner: { name: "Owner", email: `own-a-${stamp}@example.test` } });
  const b = await testAcademy({ name: `Own B ${stamp}`, slug: `own-b-${stamp}`, owner: { name: "Owner B", email: `own-b-${stamp}@example.test` } });
  [A, B] = [a.tenant.id, b.tenant.id];
  owner = await ctxFor(A, a.owner.id);
  const teacherRole = (await withTenant(A, listRoles)).find((r) => r.name === "Teacher")?.id ?? "";
  const t = await withTenant(A, (tx) => addStaff(tx, owner, { email: `own-t-${stamp}@example.test`, fullName: "Teacher", roleIds: [teacherRole] }));
  teacher = await ctxFor(A, t.staff.id);

  ids.paid = await paidThenOwing(A, "Paid");
  ids.waiting = (await start(A, "Waiting", a.subscription.periodStart)).id;
  const other = await paidThenOwing(B, "Other");
  ids.otherBill = (await platformRead((tx) => listInvoices(tx, { tenantIds: [B] }))).find((i) => i.subscriptionId === other)?.id ?? "";
});

afterAll(async () => {
  await deleteTenantsCompletely([A, B].filter(Boolean));
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, [planId].filter(Boolean)));
  await removeTestActivities([KEY]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the academy's Billing page", () => {
  it("shows its own branches' modules with what each needs paid now", async () => {
    const d = await withTenant(A, (tx) => billingPage(tx, owner));
    const modules = d.branches.flatMap((b) => b.modules.map((m) => ({ branch: b.name, status: m.status, due: m.duePaise })));
    expect(modules).toEqual(
      expect.arrayContaining([
        { branch: "Paid", status: "active", due: price }, // February's open bill
        { branch: "Waiting", status: "pending", due: price }, // the first month, to start it
        expect.objectContaining({ status: "trial", due: 0n }),
      ]),
    );
    expect(modules).toHaveLength(3);
    expect(d).toMatchObject({ staff: 2, staffLimit: null });
  });

  it("lists its own bills and payments only", async () => {
    const d = await withTenant(A, (tx) => billingPage(tx, owner));
    expect(d.bills.map((i) => i.subscriptionId)).toEqual([ids.paid, ids.paid]);
    expect(d.bills.map((i) => i.id)).not.toContain(ids.otherBill);
    expect(d.payments.map((p) => p.subscriptionId)).toEqual([ids.paid]);
  });

  it("opens one of its bills, with its payments; another academy's is not found", async () => {
    const { bills } = await withTenant(A, (tx) => billingPage(tx, owner));
    const first = bills.find((i) => i.status === "paid");
    const page = await withTenant(A, (tx) => billPage(tx, owner, first?.id ?? ""));
    expect(page).toMatchObject({ academy: { name: `Own ${stamp}` }, bill: { id: first?.id, status: "paid" } });
    expect(page.payments.map((p) => p.amountPaise)).toEqual([price]);
    await expect(withTenant(A, (tx) => billPage(tx, owner, ids.otherBill))).rejects.toThrow("Bill not found");
  });

  it("isn't for a teacher", async () => {
    await expect(withTenant(A, (tx) => billingPage(tx, teacher))).rejects.toThrow();
  });
});
