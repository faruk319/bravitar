import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { addTestActivities, removeTestActivities, testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { percent } from "@/lib/money/paise";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { addStaff, loadAccessContext } from "@/modules/staff/service";
import { createBranch, listBranches } from "@/modules/tenancy/repo";
import { addBranch, billingPage, billPage, ownerChangePlan, ownerRenameBranch, ownerSetCancel, startModule } from "./owner";
import { payToStart } from "./payments";
import { getBillingSettings, getSubscription, listInvoices } from "./repo";
import { activities, activityPlans } from "./schema";
import { renewSubscription, startActivity } from "./service";

// The academy's own Billing page (agreed 2026-09-30): read through its own
// transaction, so it sees its own modules, bills and payments only. Its
// changes take offered modules and plans only.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `test-own-${stamp}` as const;
const SOON = `test-soon-${stamp}` as const;
const ids = { paid: "", waiting: "", otherBill: "", other: "", otherBranch: "" };
const plan = { offered: "", bigger: "", free: "", soon: "" };
let planId = ""; // not offered
let A = "";
let B = "";
let owner: ScopedCtx;
let teacher: ScopedCtx;
let manager: ScopedCtx;
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
  await addTestActivities([
    { key: KEY, name: "Test own" },
    { key: SOON, name: "Test soon" },
  ]);
  await platformDb.update(activities).set({ status: "coming_soon" }).where(eq(activities.key, SOON));
  planId = uuidv7();
  await platformDb.insert(activityPlans).values({ id: planId, activityKey: KEY, name: "Monthly", pricePaise: 50_000n, isOffered: false });
  const offer = async (activityKey: string, name: string, pricePaise: bigint) => {
    const id = uuidv7();
    await platformDb.insert(activityPlans).values({ id, activityKey, name, pricePaise, isOffered: true });
    return id;
  };
  plan.offered = await offer(KEY, "Offered", 50_000n);
  plan.bigger = await offer(KEY, "Bigger", 100_000n);
  plan.free = await offer(KEY, "Free", 0n);
  plan.soon = await offer(SOON, "Soon", 50_000n);

  const a = await testAcademy({ name: `Own ${stamp}`, slug: `own-a-${stamp}`, owner: { name: "Owner", email: `own-a-${stamp}@example.test` } });
  const b = await testAcademy({ name: `Own B ${stamp}`, slug: `own-b-${stamp}`, owner: { name: "Owner B", email: `own-b-${stamp}@example.test` } });
  [A, B] = [a.tenant.id, b.tenant.id];
  owner = await ctxFor(A, a.owner.id);
  const teacherRole = (await withTenant(A, listRoles)).find((r) => r.name === "Teacher")?.id ?? "";
  const t = await withTenant(A, (tx) => addStaff(tx, owner, { email: `own-t-${stamp}@example.test`, fullName: "Teacher", roleId: teacherRole }));
  teacher = await ctxFor(A, t.staff.id);
  const managerRole = (await withTenant(A, listRoles)).find((r) => r.name === "Manager")?.id ?? "";
  const m = await withTenant(A, (tx) => addStaff(tx, owner, { email: `own-m-${stamp}@example.test`, fullName: "Manager", roleId: managerRole }));
  manager = await ctxFor(A, m.staff.id);

  ids.paid = await paidThenOwing(A, "Paid");
  ids.waiting = (await start(A, "Waiting", a.subscription.periodStart)).id;
  ids.other = await paidThenOwing(B, "Other");
  ids.otherBill = (await platformRead((tx) => listInvoices(tx, { tenantIds: [B] }))).find((i) => i.subscriptionId === ids.other)?.id ?? "";
  ids.otherBranch = (await platformRead((tx) => getSubscription(tx, ids.other)))?.branchId ?? "";
});

afterAll(async () => {
  await deleteTenantsCompletely([A, B].filter(Boolean));
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, [planId, ...Object.values(plan)].filter(Boolean)));
  await removeTestActivities([KEY, SOON]);
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
    expect(d).toMatchObject({ staff: 3, staffLimit: null }); // owner, teacher, manager
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

describe("the owner's changes", () => {
  const sub = (id: string) => platformRead((tx) => getSubscription(tx, id));
  const audits = (action: string, entityId: string) =>
    platformRead((tx) => tx.select({ actorId: auditLog.actorId, before: auditLog.before, after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.entityId, entityId))));

  it("offers only offered modules and plans", async () => {
    const { offer } = await withTenant(A, (tx) => billingPage(tx, owner));
    expect(offer.modules.map((m) => m.key)).toContain(KEY);
    expect(offer.modules.map((m) => m.key)).not.toContain(SOON);
    expect(offer.plans.map((p) => p.id)).toEqual(expect.arrayContaining([plan.offered, plan.bigger, plan.free]));
    expect(offer.plans.map((p) => p.id)).not.toContain(planId);
  });

  it("adds a branch with its first module, which waits for payment; names stay unique", async () => {
    const made = await withTenant(A, (tx) => addBranch(tx, owner, { name: "North", activityKey: KEY, planId: plan.offered }));
    expect(made.subscription).toMatchObject({ branchId: made.branchId, status: "pending", planId: plan.offered });
    expect((await withTenant(A, listBranches)).map((b) => b.name)).toContain("North");
    expect(await audits("branch.create", made.branchId)).toEqual([expect.objectContaining({ actorId: owner.staffId, after: expect.objectContaining({ name: "North", status: "pending" }) })]);
    await expect(withTenant(A, (tx) => addBranch(tx, owner, { name: "north", activityKey: KEY, planId: plan.offered }))).rejects.toThrow("There is already a branch called north");
  });

  it("starts a module in a branch: a free one at once; never one not on offer", async () => {
    const main = (await withTenant(A, listBranches)).find((b) => b.isDefault)?.id ?? "";
    await expect(withTenant(A, (tx) => startModule(tx, owner, main, { activityKey: KEY, planId }))).rejects.toThrow("Pick a plan on offer");
    await expect(withTenant(A, (tx) => startModule(tx, owner, main, { activityKey: KEY, planId: plan.soon }))).rejects.toThrow("Pick a plan on offer");
    await expect(withTenant(A, (tx) => startModule(tx, owner, main, { activityKey: SOON, planId: plan.soon }))).rejects.toThrow("Test soon isn't on offer");
    const free = await withTenant(A, (tx) => startModule(tx, owner, main, { activityKey: KEY, planId: plan.free }));
    expect(free.status).toBe("active");
  });

  it("moves to an offered plan only, and cancels at period end until kept on", async () => {
    expect(await withTenant(A, (tx) => ownerChangePlan(tx, owner, ids.paid, plan.bigger))).toBe("now");
    expect(await sub(ids.paid)).toMatchObject({ planId: plan.bigger, pricePaise: 100_000n });
    await expect(withTenant(A, (tx) => ownerChangePlan(tx, owner, ids.paid, planId))).rejects.toThrow("Monthly isn't on offer");

    await withTenant(A, (tx) => ownerSetCancel(tx, owner, ids.paid, true));
    expect((await sub(ids.paid))?.cancelAtPeriodEnd).toBe(true);
    await withTenant(A, (tx) => ownerSetCancel(tx, owner, ids.paid, false));
    expect((await sub(ids.paid))?.cancelAtPeriodEnd).toBe(false);
    expect(await audits("subscription.cancel", ids.paid)).toEqual([expect.objectContaining({ actorId: owner.staffId })]);
  });

  it("renames a branch, audited", async () => {
    const north = (await withTenant(A, listBranches)).find((b) => b.name === "North")?.id ?? "";
    await withTenant(A, (tx) => ownerRenameBranch(tx, owner, north, { name: "North Centre" }));
    expect((await withTenant(A, listBranches)).find((b) => b.id === north)?.name).toBe("North Centre");
    expect(await audits("branch.rename", north)).toEqual([expect.objectContaining({ before: { name: "North" }, after: { name: "North Centre" } })]);
  });

  it("removes a module waiting for payment at once; it can be added again", async () => {
    const north = (await withTenant(A, listBranches)).find((b) => b.name === "North Centre")?.id ?? "";
    const modulesAt = async () => (await withTenant(A, (tx) => billingPage(tx, owner))).branches.find((b) => b.id === north)?.modules ?? [];
    const [waiting] = await modulesAt();
    expect(waiting?.status).toBe("pending");
    await withTenant(A, (tx) => ownerSetCancel(tx, owner, waiting?.id ?? "", true));
    expect(await sub(waiting?.id ?? "")).toMatchObject({ status: "cancelled", cancelledAt: expect.any(Date) });
    expect(await modulesAt()).toEqual([]);
    expect((await withTenant(A, (tx) => startModule(tx, owner, north, { activityKey: KEY, planId: plan.offered }))).status).toBe("pending");
  });

  it("can't reach another academy's module or branch", async () => {
    await expect(withTenant(A, (tx) => ownerChangePlan(tx, owner, ids.other, plan.bigger))).rejects.toThrow("Module not found");
    await expect(withTenant(A, (tx) => ownerSetCancel(tx, owner, ids.other, true))).rejects.toThrow("Module not found");
    await expect(withTenant(A, (tx) => startModule(tx, owner, ids.otherBranch, { activityKey: KEY, planId: plan.free }))).rejects.toThrow("Branch not found");
    await expect(withTenant(A, (tx) => ownerRenameBranch(tx, owner, ids.otherBranch, { name: "Mine now" }))).rejects.toThrow("Branch not found");
    expect(await sub(ids.other)).toMatchObject({ planId, cancelAtPeriodEnd: false });
  });

  it("a manager sees the page but changes nothing in billing", async () => {
    await expect(withTenant(A, (tx) => billingPage(tx, manager))).resolves.toBeTruthy();
    await expect(withTenant(A, (tx) => ownerChangePlan(tx, manager, ids.paid, plan.offered))).rejects.toThrow();
    await expect(withTenant(A, (tx) => ownerSetCancel(tx, manager, ids.paid, true))).rejects.toThrow();
    await expect(withTenant(A, (tx) => addBranch(tx, manager, { name: "South", activityKey: KEY, planId: plan.offered }))).rejects.toThrow();
    expect(await sub(ids.paid)).toMatchObject({ planId: plan.bigger, cancelAtPeriodEnd: false });
  });
});
