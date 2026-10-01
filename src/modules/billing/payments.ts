import { z } from "zod";
import type { AuditEntry } from "@/lib/db/audit";
import { type PlatformTx, platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { isIsoDate } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { formatPaise } from "@/lib/money/format";
import { oldestFirst, type Share } from "@/modules/payments/allocation";
import {
  academyToday,
  allocate,
  allocationsOf,
  deallocate,
  getBillingSettings,
  getInvoice,
  getPayment,
  getSubscription,
  insertPayment,
  lockInvoice,
  lockPayment,
  lockSubscription,
  openBills,
  overdueNumbers,
  paymentByRequest,
  updateInvoice,
  updatePayment,
  updateSubscription,
} from "./repo";
import { type ActivitySubscription, BILLING_PAYMENT_METHODS, type BillingPayment } from "./schema";
import { dueToStart, effectivePrice, firstPeriod, issueInvoice } from "./service";

// Payments to Bravitar, recorded by hand on /platform (agreed 2026-09-30); a
// separate path from the academies' own fee payments.

type Actor = Pick<AuditEntry, "actorType" | "actorId">;
const platformId = (actor: Actor) => (actor.actorType === "platform" ? (actor.actorId ?? null) : null);

const isoDate = z.string().refine(isIsoDate, "Pick a date");
// Paise arrive as a digit string (JSON has no bigint).
const paise = z
  .string()
  .regex(/^\d{1,13}$/, "Enter an amount")
  .transform((s) => BigInt(s))
  .refine((p) => p > 0n, "Enter an amount");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

export const billingPaymentSchema = z.object({
  requestId: z.uuid(), // made by the form: the same id again is the same payment
  amountPaise: paise,
  method: z.enum(BILLING_PAYMENT_METHODS),
  reference: optionalText(80),
  receivedOn: isoDate.optional(),
  note: optionalText(300),
});

export type RecordedPayment = { payment: BillingPayment; started: boolean; resumed: boolean };

// One branch module at a time. A waiting one (or one on trial) takes exactly
// its first period, which starts it; any other pays its open bills oldest
// first. More than is owed is refused; a paused one with nothing overdue left
// resumes.
export async function recordPayment(actor: Actor, subscriptionId: string, input: z.input<typeof billingPaymentSchema>, opts: { now?: Date } = {}): Promise<RecordedPayment> {
  const d = billingPaymentSchema.parse(input);
  return withPlatformAdmin({ ...actor, action: "billing_payment.create", entityType: "billing_payment" }, async (tx, audit) => {
    const s = await lockSubscription(tx, subscriptionId);
    if (!s || s.status === "cancelled") throw new NotFoundError("Subscription");
    audit.tenantId = s.tenantId;
    // Checked under the lock, so a double click waits for the first and gets it back.
    const again = await paymentByRequest(tx, d.requestId);
    if (again) {
      if (again.subscriptionId !== s.id || again.amountPaise !== d.amountPaise) throw new ConflictError("This form was already used for a different payment");
      audit.entityId = again.id;
      audit.after = { repeated: true };
      return { payment: again, started: false, resumed: false };
    }
    const today = await academyToday(tx, s.tenantId, opts.now);
    const receivedOn = d.receivedOn ?? today;
    if (receivedOn > today) throw new BadRequestError("The received date can't be in the future");

    let shares: Share[];
    const started = s.status === "pending" || s.status === "trial";
    if (started) {
      const due = dueToStart(s, (await getBillingSettings(tx)).taxRateBp, today);
      if (d.amountPaise !== due) throw new ConflictError(`The first ${s.billingInterval} is ${formatPaise(due)}`);
      const period = firstPeriod(s, today);
      const bill = await issueInvoice(tx, s, period, effectivePrice(s, period.start), today, today);
      await updateSubscription(tx, s.id, { status: "active", anchorDay: Number(period.start.slice(8)), periodStart: period.start, periodEnd: period.end, cancelAtPeriodEnd: false, nextPlanId: null });
      shares = [{ invoiceId: bill.id, amountPaise: due }];
    } else {
      const open = await openBills(tx, s.id);
      const owed = open.reduce((sum, b) => sum + b.balance, 0n);
      if (owed === 0n) throw new ConflictError("Nothing is owed for this module");
      if (d.amountPaise > owed) throw new ConflictError(`That's more than the ${formatPaise(owed)} owed`);
      shares = oldestFirst(
        d.amountPaise,
        open.map((b) => ({ invoiceId: b.id, balance: b.balance })),
      ).shares;
    }

    const payment = await insertPayment(tx, {
      tenantId: s.tenantId,
      subscriptionId: s.id,
      requestId: d.requestId,
      amountPaise: d.amountPaise,
      method: d.method,
      reference: d.reference,
      receivedOn,
      note: d.note,
      recordedBy: platformId(actor),
      started,
    }).catch((e: unknown) => {
      if (isUniqueViolation(e)) throw new ConflictError("This payment was already recorded");
      throw e;
    });
    for (const share of shares) await allocate(tx, { tenantId: s.tenantId, paymentId: payment.id, invoiceId: share.invoiceId, amountPaise: share.amountPaise });
    const resumed = await resumeIfClear(tx, s, today);
    audit.entityId = payment.id;
    audit.after = { subscriptionId: s.id, amountPaise: String(payment.amountPaise), method: payment.method, receivedOn, bills: shares.map((x) => x.invoiceId), started, resumed };
    return { payment, started, resumed };
  });
}

// Exactly what starting it takes, by UPI: how the seed and tests start a paid
// module.
export async function payToStart(actor: Actor, subscriptionId: string, opts: { now?: Date } = {}): Promise<RecordedPayment> {
  const due = await platformRead(async (tx) => {
    const s = await getSubscription(tx, subscriptionId);
    if (!s) throw new NotFoundError("Subscription");
    return dueToStart(s, (await getBillingSettings(tx)).taxRateBp, await academyToday(tx, s.tenantId, opts.now));
  });
  return recordPayment(actor, subscriptionId, { requestId: uuidv7(), amountPaise: String(due), method: "upi" }, opts);
}

// A paused module with nothing overdue left works again.
async function resumeIfClear(tx: PlatformTx, s: ActivitySubscription, today: string): Promise<boolean> {
  if (s.status !== "paused" || (await overdueNumbers(tx, s.id, today)).length) return false;
  await updateSubscription(tx, s.id, { status: "active", pausedAt: null });
  return true;
}

// ---- corrections (agreed 2026-09-30): each with a reason, and both keep their record

export const reasonSchema = z.object({ reason: z.string().trim().min(3, "Add a reason").max(300) });

// Only a bill with nothing paid on it. It keeps its number and isn't owed, so
// a paused module with nothing else overdue resumes.
export async function voidBill(actor: Actor, invoiceId: string, input: z.input<typeof reasonSchema>, opts: { now?: Date } = {}): Promise<void> {
  const { reason } = reasonSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: "billing_invoice.void", entityType: "billing_invoice", entityId: invoiceId }, async (tx, audit) => {
    const found = await getInvoice(tx, invoiceId);
    if (!found) throw new NotFoundError("Bill");
    const s = await lockSubscription(tx, found.subscriptionId); // the module first, as payments do
    const bill = await lockInvoice(tx, invoiceId);
    if (!s || !bill || bill.status === "void") throw new NotFoundError("Bill");
    audit.tenantId = bill.tenantId;
    if (bill.paidPaise > 0n) throw new ConflictError(`${bill.number} has money paid on it: cancel that payment first`);
    await updateInvoice(tx, bill.id, { status: "void", voidedAt: new Date(), voidReason: reason, voidedBy: platformId(actor) });
    const resumed = await resumeIfClear(tx, s, await academyToday(tx, s.tenantId, opts.now));
    audit.after = { number: bill.number, reason, resumed };
  });
}

// Its money comes off its bills, which open again. The payment that started
// a module, while that module is still in its first period, undoes the start:
// the first bill is voided and the module waits again (or is back on trial if
// it was paid during the trial). Otherwise a reopened bill past its due date
// pauses the module at once.
export async function cancelPayment(actor: Actor, paymentId: string, input: z.input<typeof reasonSchema>, opts: { now?: Date } = {}): Promise<void> {
  const { reason } = reasonSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: "billing_payment.cancel", entityType: "billing_payment", entityId: paymentId }, async (tx, audit) => {
    const found = await getPayment(tx, paymentId);
    if (!found) throw new NotFoundError("Payment");
    const s = await lockSubscription(tx, found.subscriptionId);
    const payment = await lockPayment(tx, paymentId);
    if (!s || !payment) throw new NotFoundError("Payment");
    if (payment.cancelledAt) throw new ConflictError("This payment is already cancelled");
    audit.tenantId = payment.tenantId;
    const today = await academyToday(tx, s.tenantId, opts.now);
    const shares = await allocationsOf(tx, payment.id);
    for (const share of shares) await deallocate(tx, share.invoiceId, share.amountPaise);
    await updatePayment(tx, payment.id, { cancelledAt: new Date(), cancelReason: reason, cancelledBy: platformId(actor) });

    const first = payment.started && shares[0] ? await getInvoice(tx, shares[0].invoiceId) : undefined;
    const undoStart = first !== undefined && s.status !== "cancelled" && first.periodStart === s.periodStart;
    let paused = false;
    if (undoStart) {
      await updateInvoice(tx, first.id, { status: "void", voidedAt: new Date(), voidReason: `Payment cancelled: ${reason}`, voidedBy: platformId(actor) });
      const trialLeft = first.periodStart > today; // paid during a trial that hasn't ended
      await updateSubscription(tx, s.id, trialLeft ? { status: "trial", periodStart: today, periodEnd: first.periodStart } : { status: "pending", periodStart: today, periodEnd: today });
    } else if (s.status === "active" && (await overdueNumbers(tx, s.id, today)).length) {
      await updateSubscription(tx, s.id, { status: "paused", pausedAt: new Date() });
      paused = true;
    }
    audit.after = { reason, amountPaise: String(payment.amountPaise), bills: shares.map((x) => x.invoiceId), undoneStart: undoStart, paused };
  });
}
