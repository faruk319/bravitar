import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { addTestActivities, removeTestActivities, testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, monthsLaterOn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { formatPaise } from "@/lib/money/format";
import { percent } from "@/lib/money/paise";
import { addProgram, createBatch } from "@/modules/batches/service";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { lockedActivities } from "./access";
import { runBillingRenew } from "./job";
import { payToStart, recordPayment } from "./payments";
import { getBillingSettings } from "./repo";
import { type ActivitySubscription, activityPlans, activitySubscriptions, type BillingInterval, billingInvoices, billingPayments } from "./schema";
import { changePlan, pauseIfOverdue, renewSubscription, startActivity } from "./service";

// Pay first, then start (agreed 2026-09-30): a new paid start, and a trial that
// ends unpaid, wait read-only with no bill until the first period is paid.
// Payments are recorded on /platform one branch module at a time.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `test-pay-${stamp}` as const;
const plan = { monthly: "", yearly: "", cheap: "", trial: "" };
let A = "";
let T = "";
let today = "";
let tax = 0;
let owner: ScopedCtx;
let waiting: ActivitySubscription;
let trial: { main: ActivitySubscription; early: ActivitySubscription };

const makePlan = async (activityKey: string, name: string, price: bigint, billingInterval: BillingInterval = "month") => {
  const id = uuidv7();
  await platformDb.insert(activityPlans).values({ id, activityKey, name, pricePaise: price, billingInterval, isOffered: false });
  return id;
};
const withTax = (paise: bigint) => paise + percent(paise, tax);
const noon = (date: string) => new Date(`${date}T12:00:00+05:30`); // on India time
const start = (name: string, planId: string, on = today) =>
  withPlatformAdmin({ action: "test.pay.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId: A, name: `${name} branch` });
    return startActivity(tx, { tenantId: A, branchId: branch.id, activityKey: KEY, planId, today: on, trial: false });
  });
const pay = (subscriptionId: string, amount: bigint, extra: { requestId?: string; receivedOn?: string; now?: Date } = {}) =>
  recordPayment(ME, subscriptionId, { requestId: extra.requestId ?? uuidv7(), amountPaise: String(amount), method: "upi", ...(extra.receivedOn ? { receivedOn: extra.receivedOn } : {}) }, extra.now ? { now: extra.now } : {});
const sub = async (id: string) => (await platformRead((tx) => tx.select().from(activitySubscriptions).where(eq(activitySubscriptions.id, id))))[0];
const billsOf = (id: string) =>
  platformRead((tx) => tx.select().from(billingInvoices).where(eq(billingInvoices.subscriptionId, id)).orderBy(asc(billingInvoices.periodStart)));
const paymentsOf = (id: string) => platformRead((tx) => tx.select().from(billingPayments).where(eq(billingPayments.subscriptionId, id)));

beforeAll(async () => {
  tax = (await platformRead(getBillingSettings)).taxRateBp;
  await addTestActivities([{ key: KEY, name: "Test pay" }]);
  plan.monthly = await makePlan(KEY, "Monthly", 50_000n);
  plan.yearly = await makePlan(KEY, "Yearly", 500_000n, "year");
  plan.cheap = await makePlan(KEY, "Cheap", 20_000n);
  plan.trial = await makePlan("general", `Trial ${stamp}`, 40_000n);

  const a = await testAcademy({ name: `Pay ${stamp}`, slug: `pay-${stamp}`, owner: { name: "Owner", email: `pay-${stamp}@example.test` } });
  A = a.tenant.id;
  today = await withTenant(A, tenantToday);
  const [base, branchIds] = await withTenant(A, async (tx) => [await loadAccessContext(tx, a.owner.id), await staffBranchIds(tx, a.owner.id)] as const);
  owner = { ...base, branchIds };
  waiting = await start("Waiting", plan.monthly);

  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Pay trial ${stamp}`, slug: `pay-t-${stamp}`, planId: plan.trial, owner: { name: "Owner T", email: `pay-t-${stamp}@example.test` } });
  T = t.tenant.id;
  const early = await withPlatformAdmin({ action: "test.pay.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId: T, name: "Second" });
    return startActivity(tx, { tenantId: T, branchId: branch.id, activityKey: "general", planId: plan.trial, today: t.subscription.periodStart, trial: true });
  });
  trial = { main: t.subscription, early };
});

afterAll(async () => {
  await deleteTenantsCompletely([A, T].filter(Boolean));
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, Object.values(plan).filter(Boolean)));
  await removeTestActivities([KEY]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("a paid start", () => {
  it("waits for its first payment, read-only, with no bill", async () => {
    expect(waiting.status).toBe("pending");
    expect(await billsOf(waiting.id)).toEqual([]);
    const slots = [{ weekday: 1, startTime: "17:00", endTime: "18:00" }];
    await expect(
      withTenant(A, async (tx) => {
        const programId = (await addProgram(tx, owner, { name: "Pay program", activityKey: KEY })).id;
        return createBatch(tx, owner, { name: "Too soon", programId, branchId: waiting.branchId, slots, startDate: today });
      }),
    ).rejects.toThrow("Test pay at Waiting branch is waiting for payment. Subscribe in Billing.");
    expect(await withTenant(A, (tx) => lockedActivities(tx, []))).toContainEqual({ activity: "Test pay", branch: "Waiting branch", status: "pending" });
  });

  it("starts with exactly its first month, from the day it's paid, and records it once", async () => {
    const due = withTax(50_000n);
    await expect(pay(waiting.id, due - 100n)).rejects.toThrow(`The first month is ${formatPaise(due)}`);
    const requestId = uuidv7();
    const first = await pay(waiting.id, due, { requestId });
    expect(first).toMatchObject({ started: true, resumed: false });
    expect(await sub(waiting.id)).toMatchObject({ status: "active", anchorDay: Number(today.slice(8)), periodStart: today, periodEnd: monthsLaterOn(today, 1, Number(today.slice(8))) });
    expect(await billsOf(waiting.id)).toMatchObject([{ status: "paid", paidPaise: due, totalPaise: due, issuedOn: today, dueOn: today }]);
    expect((await pay(waiting.id, due, { requestId })).payment.id).toBe(first.payment.id); // a double click
    expect(await paymentsOf(waiting.id)).toHaveLength(1);
    await expect(pay(waiting.id, due - 1n, { requestId })).rejects.toThrow("This form was already used for a different payment");
    const audit = await platformRead((tx) => tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "billing_payment.create"), eq(auditLog.entityId, first.payment.id))));
    expect(audit).toHaveLength(2); // the payment and the double click, in any order
    expect(audit).toContainEqual({ after: expect.objectContaining({ started: true, amountPaise: String(due) }) });
  });

  it("on a yearly plan, starts with its first year", async () => {
    const s = await start("Yearly", plan.yearly);
    const due = withTax(500_000n);
    await expect(pay(s.id, due - 100n)).rejects.toThrow(`The first year is ${formatPaise(due)}`);
    await pay(s.id, due);
    expect((await sub(s.id))?.periodEnd).toBe(monthsLaterOn(today, 12, Number(today.slice(8))));
  });

  it("changes plan at once while it waits, since nothing is paid yet", async () => {
    const s = await start("Change", plan.monthly);
    expect(await changePlan(ME, s.id, plan.cheap)).toBe("now");
    expect(await sub(s.id)).toMatchObject({ status: "pending", planId: plan.cheap, pricePaise: 20_000n });
    await expect(pay(s.id, withTax(20_000n), { receivedOn: addDays(today, 1) })).rejects.toThrow("The received date can't be in the future");
  });
});

describe("later payments", () => {
  it("pay the oldest bills first, part payments allowed, and resume the module once nothing is overdue", async () => {
    const s = await start("Later", plan.monthly, "2026-01-15");
    await payToStart(ME, s.id, { now: noon("2026-01-15") });
    await renewSubscription(s.id, "2026-03-15"); // two months: two open bills
    const dayAfterDue = addDays((await billsOf(s.id))[1]?.dueOn ?? "", 1);
    expect(await pauseIfOverdue(s.id, dayAfterDue)).toBe(true);
    const bill = withTax(50_000n);
    const now = noon(dayAfterDue);
    await expect(pay(waiting.id, 100n, { now })).rejects.toThrow("Nothing is owed for this module");
    await expect(pay(s.id, 2n * bill + 1n, { now })).rejects.toThrow(`That's more than the ${formatPaise(2n * bill)} owed`);
    expect(await pay(s.id, bill + 100n, { now })).toMatchObject({ started: false, resumed: false });
    expect((await billsOf(s.id)).slice(1).map((b) => [b.status, b.paidPaise])).toEqual([
      ["paid", bill],
      ["open", 100n],
    ]);
    expect(await pay(s.id, bill - 100n, { now })).toMatchObject({ resumed: true });
    expect((await sub(s.id))?.status).toBe("active");
  });
});

describe("a trial", () => {
  it("paid during the trial, starts its paid month when the trial ends", async () => {
    const due = withTax(40_000n);
    const tToday = trial.early.periodStart;
    const from = trial.early.periodEnd > tToday ? trial.early.periodEnd : tToday;
    await payToStart(ME, trial.early.id);
    expect(await sub(trial.early.id)).toMatchObject({ status: "active", periodStart: from, periodEnd: monthsLaterOn(from, 1, Number(from.slice(8))) });
    expect(await billsOf(trial.early.id)).toMatchObject([{ periodStart: from, status: "paid", totalPaise: due, issuedOn: tToday }]);
  });

  it("that ends unpaid waits with no bill; paying later starts it from that day", async () => {
    const end = trial.main.periodEnd;
    await runBillingRenew({ now: noon(end), tenantIds: [T] });
    expect((await sub(trial.main.id))?.status).toBe("pending");
    expect(await billsOf(trial.main.id)).toEqual([]);
    const later = addDays(end, 3);
    await payToStart(ME, trial.main.id, { now: noon(later) });
    expect(await sub(trial.main.id)).toMatchObject({ status: "active", periodStart: later });
  });
});
