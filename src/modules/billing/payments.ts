import { z } from "zod";
import type { AuditEntry } from "@/lib/db/audit";
import { platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { isIsoDate } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { formatPaise } from "@/lib/money/format";
import { oldestFirst, type Share } from "@/modules/payments/allocation";
import { academyToday, allocate, getBillingSettings, getSubscription, insertPayment, lockSubscription, openBills, overdueNumbers, paymentByRequest, updateSubscription } from "./repo";
import { BILLING_PAYMENT_METHODS, type BillingPayment } from "./schema";
import { dueToStart, effectivePrice, firstPeriod, issueInvoice } from "./service";

// Payments to Bravitar, recorded by hand on /platform (agreed 2026-09-30); a
// separate path from the academies' own fee payments.

type Actor = Pick<AuditEntry, "actorType" | "actorId">;

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
      recordedBy: actor.actorType === "platform" ? (actor.actorId ?? null) : null,
    }).catch((e: unknown) => {
      if (isUniqueViolation(e)) throw new ConflictError("This payment was already recorded");
      throw e;
    });
    for (const share of shares) await allocate(tx, { tenantId: s.tenantId, paymentId: payment.id, invoiceId: share.invoiceId, amountPaise: share.amountPaise });
    const resumed = s.status === "paused" && !(await overdueNumbers(tx, s.id, today)).length;
    if (resumed) await updateSubscription(tx, s.id, { status: "active", pausedAt: null });
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
