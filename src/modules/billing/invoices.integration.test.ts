import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, nextMonthOn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { percent } from "@/lib/money/paise";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { runBillingRenew } from "./job";
import { getBillingSettings } from "./repo";
import { type ActivitySubscription, activities, activityPlans, activitySubscriptions, type BillingSettings, billingInvoices } from "./schema";
import { changePlan, setCancelAtPeriodEnd, startActivity } from "./service";

// Bravitar's bills (agreed 2026-09-30): monthly in advance, one per activity in
// a branch, none for a ₹0 month. The story runs from 31 Jan 2026 on the job's
// clock; the job only ever sees this file's academies.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `inv-${stamp}`;
const D0 = "2026-01-31";
const plan = { paid: "", cheap: "", zero: "", trial: "" };
let subs: Record<"paid" | "zero" | "down" | "drop" | "cancel", ActivitySubscription>;
let trial: Record<"main" | "cancelled", ActivitySubscription>;
let A = "";
let T = "";
let settings: BillingSettings;

const makePlan = async (activityKey: string, name: string, price: bigint, maxStudents: number | null = null) => {
  const id = uuidv7();
  await platformDb.insert(activityPlans).values({ id, activityKey, name, pricePaise: price, maxStudents, isOffered: false });
  return id;
};
const start = (name: string, planId: string) =>
  withPlatformAdmin({ action: "test.invoices.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId: A, name: `${name} branch` });
    return startActivity(tx, { tenantId: A, branchId: branch.id, activityKey: KEY, planId, today: D0, trial: false });
  });
const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(A, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const run = (date: string, tenantId = A) => runBillingRenew({ now: new Date(`${date}T12:00:00+05:30`), tenantIds: [tenantId] }); // on India time
const sub = async (id: string) => (await platformRead((tx) => tx.select().from(activitySubscriptions).where(eq(activitySubscriptions.id, id))))[0];
const billsOf = (subscriptionId: string) =>
  platformRead((tx) => tx.select().from(billingInvoices).where(eq(billingInvoices.subscriptionId, subscriptionId)).orderBy(asc(billingInvoices.periodStart)));
const auditOf = (action: string, entityId: string) =>
  platformRead((tx) =>
    tx
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.action, action), eq(auditLog.entityId, entityId)))
      .orderBy(asc(auditLog.id)),
  );

beforeAll(async () => {
  settings = await platformRead(getBillingSettings);
  await platformDb.insert(activities).values({ key: KEY, name: "Test lessons" });
  plan.paid = await makePlan(KEY, "Paid", 50_000n);
  plan.cheap = await makePlan(KEY, "Cheap", 20_000n, 0);
  plan.zero = await makePlan(KEY, "Zero", 0n);
  plan.trial = await makePlan("general", `Trial ${stamp}`, 40_000n);

  const a = await testAcademy({ name: `Invoices ${stamp}`, slug: `inv-${stamp}`, owner: { name: "Owner", email: `inv-${stamp}@example.test` } });
  A = a.tenant.id;
  subs = { paid: await start("Paid", plan.paid), zero: await start("Zero", plan.zero), down: await start("Down", plan.paid), drop: await start("Drop", plan.paid), cancel: await start("Cancel", plan.paid) };
  expect(await changePlan(ME, subs.down.id, plan.cheap)).toBe("at_period_end");
  expect(await changePlan(ME, subs.drop.id, plan.cheap)).toBe("at_period_end");
  await setCancelAtPeriodEnd(ME, subs.cancel.id, true);
  await setCancelAtPeriodEnd(ME, subs.paid.id, true);
  await setCancelAtPeriodEnd(ME, subs.paid.id, false);
  // A student joins Drop after its downgrade was chosen, so it no longer fits.
  const owner = await ctxFor(a.owner.id);
  const today = await withTenant(A, tenantToday);
  await withTenant(A, async (tx) => {
    const programId = (await addProgram(tx, owner, { name: "Test program", activityKey: KEY })).id;
    const slots = [{ weekday: 1, startTime: "17:00", endTime: "18:00" }];
    const batchId = (await createBatch(tx, owner, { name: "Drop batch", programId, branchId: subs.drop.branchId, slots, startDate: today })).id;
    const guardian = { fullName: "Parent of Asha", phone: "98762 50001", relation: "mother" as const };
    const studentId = (await createStudent(tx, owner, { fullName: "Asha", branchId: subs.drop.branchId, guardian, consents: { dataProcessing: true } })).student.id;
    await enroll(tx, owner, { studentId, batchId });
  });

  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Trial ${stamp}`, slug: `inv-t-${stamp}`, planId: plan.trial, owner: { name: "Owner T", email: `inv-t-${stamp}@example.test` } });
  T = t.tenant.id;
  const cancelled = await withPlatformAdmin({ action: "test.invoices.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId: T, name: "Second" });
    return startActivity(tx, { tenantId: T, branchId: branch.id, activityKey: "general", planId: plan.trial, today: t.subscription.periodStart, trial: true });
  });
  trial = { main: t.subscription, cancelled };
  await setCancelAtPeriodEnd(ME, trial.cancelled.id, true);
});

afterAll(async () => {
  await deleteTenantsCompletely([A, T].filter(Boolean));
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, Object.values(plan).filter(Boolean)));
  await platformDb.delete(activities).where(eq(activities.key, KEY));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the first bill", () => {
  it("comes when a paid activity starts, for a month from that day", async () => {
    expect(subs.paid).toMatchObject({ status: "active", anchorDay: 31, periodStart: D0, periodEnd: "2026-02-28" });
    const bills = await billsOf(subs.paid.id);
    const tax = percent(50_000n, settings.taxRateBp);
    expect(bills).toMatchObject([
      {
        tenantId: A,
        description: "Test lessons Paid · Paid branch",
        periodStart: D0,
        periodEnd: "2026-02-28",
        subtotalPaise: 50_000n,
        taxRateBp: settings.taxRateBp,
        taxPaise: tax,
        totalPaise: 50_000n + tax,
        gstin: settings.gstin,
        status: "open",
        issuedOn: D0,
        dueOn: addDays(D0, settings.graceDays),
      },
    ]);
    expect(bills[0]?.number).toMatch(/^BRV\/2025-26\/\d{5}$/);
    expect(await auditOf("billing_invoice.issue", bills[0]?.id ?? "")).toMatchObject([{ after: { number: bills[0]?.number } }]);
  });

  it("is numbered in its financial year's series, one after another", async () => {
    const numbers = (await Promise.all([subs.paid, subs.down, subs.drop, subs.cancel].map((s) => billsOf(s.id)))).flat().map((b) => b.number);
    const serials = numbers.map((n) => Number(n.split("/")[2]));
    expect(new Set(numbers).size).toBe(4);
    expect(serials).toEqual([...serials].sort((x, y) => x - y));
  });

  it("isn't made for a ₹0 month, which still rolls on", async () => {
    expect(subs.zero).toMatchObject({ periodStart: D0, periodEnd: "2026-02-28" });
    expect(await billsOf(subs.zero.id)).toEqual([]);
  });
});

describe("an unpaid bill", () => {
  it("pauses its activity the day after it's due, not before", async () => {
    const due = addDays(D0, settings.graceDays);
    await run(due);
    expect((await sub(subs.paid.id))?.status).toBe("active");
    await run(addDays(due, 1));
    expect((await sub(subs.paid.id))?.status).toBe("paused");
    const [first] = await billsOf(subs.paid.id);
    expect(await auditOf("subscription.pause", subs.paid.id)).toMatchObject([{ after: { overdue: [first?.number] } }]);
  });
});

describe("the month's end", () => {
  it("bills the next month, while paused too, on the anchor day or the month's last day", async () => {
    await run("2026-03-01");
    expect(await sub(subs.paid.id)).toMatchObject({ status: "paused", periodStart: "2026-02-28", periodEnd: "2026-03-31" });
    expect((await billsOf(subs.paid.id)).map((b) => [b.periodStart, b.periodEnd])).toEqual([
      [D0, "2026-02-28"],
      ["2026-02-28", "2026-03-31"],
    ]);
    expect(await sub(subs.zero.id)).toMatchObject({ status: "active", periodEnd: "2026-03-31" });
    expect(await billsOf(subs.zero.id)).toEqual([]);
  });

  it("moves to a waiting downgrade at its price, or drops it when the students no longer fit", async () => {
    expect(await sub(subs.down.id)).toMatchObject({ planId: plan.cheap, pricePaise: 20_000n, nextPlanId: null });
    expect((await billsOf(subs.down.id)).at(-1)).toMatchObject({ description: "Test lessons Cheap · Down branch", subtotalPaise: 20_000n });
    expect(await sub(subs.drop.id)).toMatchObject({ planId: plan.paid, pricePaise: 50_000n, nextPlanId: null });
    expect((await billsOf(subs.drop.id)).at(-1)).toMatchObject({ periodStart: "2026-02-28", subtotalPaise: 50_000n });
    expect((await auditOf("subscription.renew", subs.drop.id))[0]).toMatchObject({ after: { droppedPlanId: plan.cheap } });
  });

  it("ends an activity cancelled at period end, with no bill; undoing it in time keeps it on", async () => {
    const cancelled = await sub(subs.cancel.id);
    expect(cancelled).toMatchObject({ status: "cancelled", periodEnd: "2026-02-28" });
    expect(cancelled?.cancelledAt).not.toBeNull();
    expect(await billsOf(subs.cancel.id)).toHaveLength(1);
    expect(await auditOf("subscription.cancel.undo", subs.paid.id)).toHaveLength(1);
    expect((await sub(subs.paid.id))?.cancelAtPeriodEnd).toBe(false);
  });

  it("bills each month once: another run the same day does nothing", async () => {
    expect(await run("2026-03-01")).toEqual({ renewed: 0, invoices: 0, paused: 0, failed: [] });
  });

  it("catches up: two months late gives two bills, both dated that day", async () => {
    await run("2026-05-01");
    const late = (await billsOf(subs.paid.id)).slice(2);
    expect(late.map((b) => [b.periodStart, b.issuedOn])).toEqual([
      ["2026-03-31", "2026-05-01"],
      ["2026-04-30", "2026-05-01"],
    ]);
    for (const b of late) expect(b.number).toMatch(/^BRV\/2026-27\//);
    expect((await sub(subs.paid.id))?.periodEnd).toBe("2026-05-31");
  });
});

describe("a trial", () => {
  it("ends in its first bill at the plan's price; one cancelled at its end has none", async () => {
    const end = trial.main.periodEnd;
    await run(end, T);
    expect(await sub(trial.main.id)).toMatchObject({ status: "active", periodStart: end, periodEnd: nextMonthOn(end, trial.main.anchorDay) });
    expect(await billsOf(trial.main.id)).toMatchObject([{ periodStart: end, subtotalPaise: 40_000n, issuedOn: end }]);
    expect(await sub(trial.cancelled.id)).toMatchObject({ status: "cancelled" });
    expect(await billsOf(trial.cancelled.id)).toEqual([]);
  });
});
