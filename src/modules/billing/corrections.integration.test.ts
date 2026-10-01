import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { addTestActivities, removeTestActivities, testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, monthsLaterOn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { percent } from "@/lib/money/paise";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { cancelPayment, payToStart, recordPayment, voidBill } from "./payments";
import { getBillingSettings } from "./repo";
import { activityPlans, activitySubscriptions, billingInvoices, billingPayments } from "./schema";
import { addTrialDays, editActivity, pauseIfOverdue, renewSubscription, setPrice, startActivity } from "./service";

// Corrections (agreed 2026-09-30): void a bill or cancel a payment, each with a
// reason. Prices: free use or a special price from the next bill. Trial days
// (agreed 2026-10-01): a module's own length, and extra days for one module.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `test-fix-${stamp}` as const;
const D0 = "2026-01-10";
let planId = "";
let A = "";
let today = "";
let tax = 0;
let defaultTrial = 0;

const noon = (date: string) => new Date(`${date}T12:00:00+05:30`); // on India time
const withTax = (paise: bigint) => paise + percent(paise, tax);
const start = (name: string, on: string, trial = false) =>
  withPlatformAdmin({ action: "test.fix.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId: A, name });
    return startActivity(tx, { tenantId: A, branchId: branch.id, activityKey: KEY, planId, today: on, trial });
  });
// Started on D0 and paid first; returns the subscription id.
const paidOnD0 = async (name: string) => {
  const s = await start(name, D0);
  await payToStart(ME, s.id, { now: noon(D0) });
  return s.id;
};
const sub = async (id: string) => (await platformRead((tx) => tx.select().from(activitySubscriptions).where(eq(activitySubscriptions.id, id))))[0];
const billsOf = (id: string) =>
  platformRead((tx) => tx.select().from(billingInvoices).where(eq(billingInvoices.subscriptionId, id)).orderBy(asc(billingInvoices.periodStart), asc(billingInvoices.createdAt)));
const paymentsOf = (id: string) => platformRead((tx) => tx.select().from(billingPayments).where(eq(billingPayments.subscriptionId, id)).orderBy(asc(billingPayments.createdAt)));
const editModule = (trialDays: string) => editActivity(ME, KEY, { name: "Test fix", description: "", icon: "shapes", status: "active", trialDays });

beforeAll(async () => {
  const settings = await platformRead(getBillingSettings);
  [tax, defaultTrial] = [settings.taxRateBp, settings.trialDays];
  await addTestActivities([{ key: KEY, name: "Test fix" }]);
  planId = uuidv7();
  await platformDb.insert(activityPlans).values({ id: planId, activityKey: KEY, name: "Monthly", pricePaise: 50_000n, isOffered: false });
  const a = await testAcademy({ name: `Fix ${stamp}`, slug: `fix-${stamp}`, owner: { name: "Owner", email: `fix-${stamp}@example.test` } });
  A = a.tenant.id;
  today = await withTenant(A, tenantToday);
});

afterAll(async () => {
  await deleteTenantsCompletely([A].filter(Boolean));
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, [planId].filter(Boolean)));
  await removeTestActivities([KEY]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("voiding a bill", () => {
  it("only an unpaid one, with a reason; a paused module with nothing else overdue resumes", async () => {
    const id = await paidOnD0("Void");
    await renewSubscription(id, "2026-02-10");
    const [paid, open] = await billsOf(id);
    const dayAfterDue = addDays(open?.dueOn ?? "", 1);
    expect(await pauseIfOverdue(id, dayAfterDue)).toBe(true);
    await expect(voidBill(ME, paid?.id ?? "", { reason: "Mistake" })).rejects.toThrow("has money paid on it: cancel that payment first");
    await expect(voidBill(ME, open?.id ?? "", { reason: "" })).rejects.toThrow("Add a reason");
    await voidBill(ME, open?.id ?? "", { reason: "Goodwill" }, { now: noon(dayAfterDue) });
    expect((await billsOf(id))[1]).toMatchObject({ status: "void", voidReason: "Goodwill", paidPaise: 0n });
    expect((await sub(id))?.status).toBe("active");
    const audit = await platformRead((tx) => tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "billing_invoice.void"), eq(auditLog.entityId, open?.id ?? ""))));
    expect(audit).toMatchObject([{ after: { reason: "Goodwill", resumed: true } }]);
  });
});

describe("cancelling a payment", () => {
  it("opens its bills again, and pauses the module when one is past due", async () => {
    const id = await paidOnD0("Bounce");
    await renewSubscription(id, "2026-02-10");
    const second = (await billsOf(id))[1];
    await recordPayment(ME, id, { requestId: uuidv7(), amountPaise: String(second?.totalPaise ?? 0n), method: "cheque" }, { now: noon("2026-02-11") });
    const cheque = (await paymentsOf(id))[1];
    const dayAfterDue = addDays(second?.dueOn ?? "", 1);
    await cancelPayment(ME, cheque?.id ?? "", { reason: "Cheque bounced" }, { now: noon(dayAfterDue) });
    expect((await billsOf(id))[1]).toMatchObject({ status: "open", paidPaise: 0n });
    expect((await paymentsOf(id))[1]).toMatchObject({ cancelReason: "Cheque bounced" });
    expect((await sub(id))?.status).toBe("paused");
    await expect(cancelPayment(ME, cheque?.id ?? "", { reason: "Again" })).rejects.toThrow("This payment is already cancelled");
  });

  it("that started the module puts it back to waiting, with its first bill void", async () => {
    const s = await start("Undo", today);
    await payToStart(ME, s.id);
    const [payment] = await paymentsOf(s.id);
    expect(payment?.started).toBe(true);
    await cancelPayment(ME, payment?.id ?? "", { reason: "Wrong academy" });
    expect((await sub(s.id))?.status).toBe("pending");
    expect(await billsOf(s.id)).toMatchObject([{ status: "void", voidReason: "Payment cancelled: Wrong academy" }]);
    await payToStart(ME, s.id); // the void bill frees its period: paid again the same day
    expect((await sub(s.id))?.status).toBe("active");
    expect((await billsOf(s.id)).map((b) => b.status)).toEqual(["void", "paid"]);
  });

  it("that started the module during its trial puts it back on trial", async () => {
    const s = await start("Early", today, true);
    await payToStart(ME, s.id);
    const [payment] = await paymentsOf(s.id);
    await cancelPayment(ME, payment?.id ?? "", { reason: "Paid twice" });
    expect(await sub(s.id)).toMatchObject({ status: "trial", periodEnd: s.periodEnd });
  });
});

describe("a special price", () => {
  it("applies from the next bill until its date, then the plan's price is back", async () => {
    const id = await paidOnD0("Pilot");
    await expect(setPrice(ME, id, { price: "150", reason: "Pilot" }, { now: noon("2026-04-01") })).resolves.toEqual({ started: false });
    await expect(setPrice(ME, id, { price: "150", until: "2026-01-01", reason: "Pilot" }, { now: noon(D0) })).rejects.toThrow("The until date has passed");
    await expect(setPrice(ME, id, { price: "150" })).rejects.toThrow("Add a reason");
    await setPrice(ME, id, { price: "150", until: "2026-03-31", reason: "Pilot" }, { now: noon(D0) });
    expect((await billsOf(id))[0]?.subtotalPaise).toBe(50_000n); // bills already made stay
    await renewSubscription(id, "2026-04-10");
    expect((await billsOf(id)).map((b) => b.subtotalPaise)).toEqual([50_000n, 15_000n, 15_000n, 50_000n]);
    await setPrice(ME, id, { price: "" });
    expect(await sub(id)).toMatchObject({ overridePaise: null, overrideUntil: null, overrideReason: null });
  });

  it("of free use starts a waiting module at once, with no bill", async () => {
    const s = await start("Free", today);
    expect(await setPrice(ME, s.id, { price: "0", reason: "Masjid pilot" })).toEqual({ started: true });
    expect(await sub(s.id)).toMatchObject({ status: "active", periodStart: today, periodEnd: monthsLaterOn(today, 1, Number(today.slice(8))) });
    expect(await billsOf(s.id)).toEqual([]);
    await expect(recordPayment(ME, s.id, { requestId: uuidv7(), amountPaise: String(withTax(50_000n)), method: "upi" })).rejects.toThrow("Nothing is owed for this module");
  });
});

describe("trial days", () => {
  it("are the module's own when set, else the default", async () => {
    await editModule("10");
    expect((await start("Own trial", today, true)).periodEnd).toBe(addDays(today, 10));
    await editModule("");
    expect((await start("Default trial", today, true)).periodEnd).toBe(addDays(today, defaultTrial));
  });

  it("can be added to a trial, or reopen a module waiting for payment, never a paid one", async () => {
    const trial = await start("Longer", today, true);
    expect(await addTrialDays(ME, trial.id, { days: 5, reason: "Asked for more time" })).toEqual({ until: addDays(trial.periodEnd, 5) });
    const waiting = await start("Reopen", today);
    await addTrialDays(ME, waiting.id, { days: 7, reason: "Second chance" });
    expect(await sub(waiting.id)).toMatchObject({ status: "trial", periodEnd: addDays(today, 7) });
    const paid = await paidOnD0("Paid");
    await expect(addTrialDays(ME, paid, { days: 7, reason: "Nope" })).rejects.toThrow("Only a trial, or a module waiting for payment, can get trial days");
    const audit = await platformRead((tx) => tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "subscription.trial.extend"), eq(auditLog.entityId, waiting.id))));
    expect(audit).toMatchObject([{ after: { days: 7, reason: "Second chance" } }]);
  });
});
