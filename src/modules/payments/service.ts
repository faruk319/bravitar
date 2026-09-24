import { z } from "zod";
import { allows, assertCan, ForbiddenError } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, isIsoDate, todayIn } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { financialYear } from "@/lib/money/fy";
import { type Paise, sum } from "@/lib/money/paise";
import type { Actor } from "@/modules/fees/invoicing";
import { getInvoice } from "@/modules/fees/repo";
import type { Invoice } from "@/modules/fees/schema";
import { allocateNumber } from "@/modules/numbering/repo";
import { getHousehold } from "@/modules/students/repo";
import { getBranch, getOwnTenant } from "@/modules/tenancy/repo";
import { oldestFirst, picked, refundFrom } from "./allocation";
import {
  collectedOn,
  getPayment,
  insertPayment,
  insertRefund,
  lockFamily,
  lockPayment,
  moveMoney,
  openInvoices,
  paidByPayment,
  paymentByRequest,
  paymentMoney,
  paymentsOnInvoice,
  type InvoiceReceipt,
  paymentsRecordedOn,
  type ReceiptLine,
  receiptLines,
  receiptNames,
  receiptsOnInvoice,
  refundsOf,
  refundsOn,
  type SheetPayment,
  type SheetRefund,
  unusedPayments,
  updatePayment,
} from "./repo";
import { PAYMENT_METHODS, type Payment, type PaymentMethod, type Refund } from "./schema";

const actor = (ctx: ScopedCtx): Actor => ({ actorType: "staff", actorId: ctx.staffId, tenantId: ctx.tenantId });
const isoDate = z.string().refine(isIsoDate, "Pick a date");
// Paise arrive as a digit string (JSON has no bigint).
const paise = z
  .string()
  .regex(/^\d{1,13}$/, "Enter an amount")
  .transform((s) => BigInt(s))
  .refine((p) => p > 0n, "Enter an amount");
const text = (p: Paise) => p.toString(); // audit JSON has no bigint

// What staff record by hand. Card and online payments come from the gateway (Prompt 16).
export const HAND_METHODS = ["cash", "upi", "bank_transfer", "cheque"] as const;
export const BACKDATE_DAYS = 7;

const inScope = (ctx: ScopedCtx, branchId: string) => !ctx.branchIds.length || ctx.branchIds.includes(branchId);

async function clock(tx: Tx, now: Date = new Date()): Promise<{ now: Date; today: string; fyStartMonth: number }> {
  const t = await getOwnTenant(tx);
  return { now, today: todayIn(t?.timezone ?? "Asia/Kolkata", now), fyStartMonth: t?.fyStartMonth ?? 4 };
}

async function requireBranch(tx: Tx, ctx: ScopedCtx, branchId: string): Promise<void> {
  if (!inScope(ctx, branchId) || !(await getBranch(tx, branchId))) throw new NotFoundError("Branch");
}

async function requirePayment(tx: Tx, ctx: ScopedCtx, id: string): Promise<Payment> {
  const p = await getPayment(tx, ctx.branchIds, id);
  if (!p) throw new NotFoundError("Payment");
  return p;
}

// ---- recording (docs/04 "Payment recording", docs/03 §9 agreed 2026-09-24)

export const paymentSchema = z.object({
  requestId: z.uuid(), // made by the collect form; the same id again is the same payment
  householdId: z.uuid(),
  branchId: z.uuid(),
  amountPaise: paise,
  method: z.enum(HAND_METHODS).default("cash"),
  reference: z.string().trim().max(80).optional(),
  receivedOn: isoDate.optional(),
  notes: z.string().trim().max(300).optional(),
  allocations: z.array(z.object({ invoiceId: z.uuid(), amountPaise: paise })).max(100).optional(),
});
export type PaymentInput = z.input<typeof paymentSchema>;

// Today, or up to 7 days back within this financial year. The collect screen's
// date picker uses the same range.
export function receivedOnRange(today: string, fyStartMonth: number): { earliest: string; latest: string } {
  const back = addDays(today, -BACKDATE_DAYS);
  const fyStart = `${financialYear(today, fyStartMonth).slice(0, 4)}-${String(fyStartMonth).padStart(2, "0")}-01`;
  return { earliest: back > fyStart ? back : fyStart, latest: today };
}

function checkReceivedOn(receivedOn: string, today: string, fyStartMonth: number): void {
  if (receivedOn > today) throw new BadRequestError("The received date can't be in the future");
  if (receivedOn < addDays(today, -BACKDATE_DAYS)) throw new BadRequestError(`Only up to ${BACKDATE_DAYS} days back`);
  if (receivedOn < receivedOnRange(today, fyStartMonth).earliest) throw new BadRequestError("Not before this financial year began");
}

export type CollectScreen = { account: FamilyAccount; householdName: string; branchName: string; today: string; earliest: string };

// Everything the collect screen needs for one family at one branch.
export async function collectScreen(tx: Tx, ctx: ScopedCtx, householdId: string, branchId: string, opts: { now?: Date } = {}): Promise<CollectScreen> {
  assertCan(ctx, "fees:collect");
  const [account, household, branch, { today, fyStartMonth }] = await Promise.all([familyAccount(tx, ctx, householdId, branchId), getHousehold(tx, householdId), getBranch(tx, branchId), clock(tx, opts.now)]);
  return { account, householdName: household?.name ?? "", branchName: branch?.name ?? "", today, earliest: receivedOnRange(today, fyStartMonth).earliest };
}

// Oldest invoice first unless invoices are picked; what is left is the family's
// advance in this branch. The receipt number is taken in this transaction, so a
// failure gives it back.
export async function recordPayment(tx: Tx, ctx: ScopedCtx, input: PaymentInput, opts: { now?: Date } = {}): Promise<Payment> {
  assertCan(ctx, "fees:collect");
  const data = paymentSchema.parse(input);
  await requireBranch(tx, ctx, data.branchId);
  if (!(await getHousehold(tx, data.householdId))) throw new NotFoundError("Family");
  const { today, fyStartMonth } = await clock(tx, opts.now);
  const receivedOn = data.receivedOn ?? today;
  checkReceivedOn(receivedOn, today, fyStartMonth);

  await lockFamily(tx, data.householdId);
  // Checked under the lock, so a double tap waits for the first and returns it.
  const again = await paymentByRequest(tx, data.requestId);
  if (again) {
    if (again.householdId !== data.householdId || again.branchId !== data.branchId || again.amountPaise !== data.amountPaise) throw new ConflictError("This form was already used for a different payment");
    return again;
  }
  const open = (await openInvoices(tx, data.householdId, data.branchId)).map((i) => ({ invoiceId: i.id, balance: i.totalPaise - i.paidPaise }));
  const split = data.allocations ? picked(data.amountPaise, open, data.allocations) : oldestFirst(data.amountPaise, open);
  const fy = financialYear(today, fyStartMonth);
  const receiptNumber = await allocateNumber(tx, ctx.tenantId, "receipt", fy);
  const payment = await insertPayment(tx, {
    tenantId: ctx.tenantId,
    branchId: data.branchId,
    householdId: data.householdId,
    requestId: data.requestId,
    receiptNumber,
    fy,
    method: data.method,
    amountPaise: data.amountPaise,
    receivedOn,
    recordedOn: today,
    receivedBy: ctx.staffId,
    reference: data.reference || null,
    notes: data.notes || null,
  }).catch((e: unknown) => {
    if (isUniqueViolation(e)) throw new ConflictError("This payment was already recorded");
    throw e;
  });
  for (const s of split.shares) await moveMoney(tx, { tenantId: ctx.tenantId, paymentId: payment.id, invoiceId: s.invoiceId, kind: "receipt", amountPaise: s.amountPaise, createdBy: ctx.staffId });
  await writeAudit(tx, {
    ...actor(ctx),
    action: "payment.create",
    entityType: "payment",
    entityId: payment.id,
    after: {
      receiptNumber,
      amountPaise: text(payment.amountPaise),
      method: payment.method,
      receivedOn,
      recordedOn: today,
      branchId: payment.branchId,
      householdId: payment.householdId,
      invoices: split.shares.map((s) => ({ invoiceId: s.invoiceId, amountPaise: text(s.amountPaise) })),
      advancePaise: text(split.advance),
    },
  });
  return payment;
}

// ---- cancel on the day (docs/03 §9: nothing is edited)

export const cancelSchema = z.object({ reason: z.string().trim().min(3, "Add a reason").max(200) });

// By whoever recorded it, or anyone who can refund, on the day it was recorded.
// The number stays; the money comes off its invoices and off the day's total.
export async function cancelPayment(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof cancelSchema>, opts: { now?: Date } = {}): Promise<Payment> {
  assertCan(ctx, "fees:collect");
  const data = cancelSchema.parse(input);
  const found = await requirePayment(tx, ctx, id);
  if (found.receivedBy !== ctx.staffId && !allows(ctx, "fees:refund")) throw new ForbiddenError("Only the person who recorded it, or someone who can refund, can cancel it");
  await lockFamily(tx, found.householdId);
  const p = await lockPayment(tx, id);
  if (p.status === "cancelled") throw new ConflictError("Already cancelled");
  if (p.status !== "confirmed") throw new ConflictError("Only a confirmed payment can be cancelled");
  const { now, today } = await clock(tx, opts.now);
  if (p.recordedOn !== today) throw new ConflictError("Only on the day it was recorded. Refund it instead.");
  if ((await paymentMoney(tx, id)).refunded > 0n) throw new ConflictError("It has a refund. Refund the rest instead.");
  const released = await paidByPayment(tx, id);
  for (const r of released) await moveMoney(tx, { tenantId: ctx.tenantId, paymentId: id, invoiceId: r.invoiceId, kind: "cancel", amountPaise: -r.net, createdBy: ctx.staffId });
  const after = await updatePayment(tx, id, { status: "cancelled", cancelledAt: now, cancelledBy: ctx.staffId, cancelReason: data.reason });
  await writeAudit(tx, {
    ...actor(ctx),
    action: "payment.cancel",
    entityType: "payment",
    entityId: id,
    before: { status: p.status },
    after: { receiptNumber: p.receiptNumber, reason: data.reason, released: released.map((r) => ({ invoiceId: r.invoiceId, amountPaise: text(r.net) })) },
  });
  return after;
}

// ---- refunds (docs/04 "Refunds")

export const refundSchema = z.object({
  amountPaise: paise,
  method: z.enum(HAND_METHODS).default("cash"), // how the money went back
  reference: z.string().trim().max(80).optional(),
  reason: z.string().trim().min(3, "Add a reason").max(200),
  invoiceId: z.uuid().optional(), // after the advance, take it off this invoice first
});

// Out of the payment's unused advance first, then its invoices, which reopen.
// The payment and its receipt never change; a refund is its own row.
export async function refundPayment(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof refundSchema>, opts: { now?: Date } = {}): Promise<Refund> {
  assertCan(ctx, "fees:refund");
  const data = refundSchema.parse(input);
  const found = await requirePayment(tx, ctx, id);
  await lockFamily(tx, found.householdId);
  const p = await lockPayment(tx, id);
  if (p.status === "cancelled") throw new ConflictError("A cancelled payment can't be refunded");
  if (p.status !== "confirmed") throw new ConflictError("Nothing is left on this payment");
  const [{ allocated, refunded }, paid] = await Promise.all([paymentMoney(tx, id), paidByPayment(tx, id)]);
  if (data.invoiceId && !paid.some((x) => x.invoiceId === data.invoiceId)) throw new BadRequestError("This payment has nothing on that invoice");
  const from = refundFrom(data.amountPaise, p.amountPaise - allocated - refunded, paid, data.invoiceId);
  const { now, today } = await clock(tx, opts.now);
  const refund = await insertRefund(tx, {
    tenantId: ctx.tenantId,
    paymentId: id,
    amountPaise: data.amountPaise,
    method: data.method,
    reference: data.reference || null,
    reason: data.reason,
    refundedOn: today,
    approvedBy: ctx.staffId,
    refundedAt: now,
  });
  for (const s of from.fromInvoices) await moveMoney(tx, { tenantId: ctx.tenantId, paymentId: id, invoiceId: s.invoiceId, kind: "refund", amountPaise: -s.amountPaise, refundId: refund.id, createdBy: ctx.staffId });
  if (refunded + data.amountPaise === p.amountPaise) await updatePayment(tx, id, { status: "refunded" });
  await writeAudit(tx, {
    ...actor(ctx),
    action: "payment.refund",
    entityType: "payment",
    entityId: id,
    after: {
      refundId: refund.id,
      amountPaise: text(data.amountPaise),
      method: data.method,
      reason: data.reason,
      fromAdvancePaise: text(from.fromAdvance),
      fromInvoices: from.fromInvoices.map((s) => ({ invoiceId: s.invoiceId, amountPaise: text(s.amountPaise) })),
    },
  });
  return refund;
}

// ---- the advance, and money released by a void (called by fees)

// The family's unused money in a branch pays its open invoices, oldest money
// to the oldest invoice. Runs when invoices are issued (docs/03 §9).
export async function applyAdvance(tx: Tx, by: Actor, householdId: string, branchId: string): Promise<Paise> {
  await lockFamily(tx, householdId);
  const [unused, open] = await Promise.all([unusedPayments(tx, householdId, branchId), openInvoices(tx, householdId, branchId)]);
  const balances = open.map((i) => ({ invoiceId: i.id, balance: i.totalPaise - i.paidPaise }));
  let applied = 0n;
  for (const u of unused) {
    for (const s of oldestFirst(u.unused, balances).shares) {
      await moveMoney(tx, { tenantId: by.tenantId, paymentId: u.paymentId, invoiceId: s.invoiceId, kind: "advance", amountPaise: s.amountPaise, createdBy: by.actorId ?? null });
      await writeAudit(tx, { ...by, action: "payment.apply_advance", entityType: "invoice", entityId: s.invoiceId, after: { paymentId: u.paymentId, amountPaise: text(s.amountPaise) } });
      const b = balances.find((x) => x.invoiceId === s.invoiceId);
      if (b) b.balance -= s.amountPaise;
      applied += s.amountPaise;
    }
  }
  return applied;
}

// Voiding an invoice with money on it: each payment's money comes off as a
// 'void' row and is the family's advance again (docs/03 §6). Nothing is deleted.
export async function releaseInvoice(tx: Tx, by: Actor, invoice: Pick<Invoice, "id" | "householdId">): Promise<Paise> {
  await lockFamily(tx, invoice.householdId);
  let released = 0n;
  for (const p of await paymentsOnInvoice(tx, invoice.id)) {
    await moveMoney(tx, { tenantId: by.tenantId, paymentId: p.paymentId, invoiceId: invoice.id, kind: "void", amountPaise: -p.net, createdBy: by.actorId ?? null });
    await writeAudit(tx, { ...by, action: "payment.release", entityType: "invoice", entityId: invoice.id, after: { paymentId: p.paymentId, amountPaise: text(p.net) } });
    released += p.net;
  }
  return released;
}

// ---- reading

export type OpenInvoiceRow = Pick<Invoice, "id" | "number" | "dueDate" | "totalPaise" | "paidPaise" | "status"> & { balancePaise: Paise };
export type FamilyAccount = { open: OpenInvoiceRow[]; advancePaise: Paise };

// What the collect screen shows for a family in one branch: its open invoices,
// oldest first, and its advance (docs/03 §9: visible on the family).
export async function familyAccount(tx: Tx, ctx: ScopedCtx, householdId: string, branchId: string): Promise<FamilyAccount> {
  if (!allows(ctx, "fees:collect") && !allows(ctx, "invoices:read")) throw new ForbiddenError("Not allowed: fees");
  await requireBranch(tx, ctx, branchId);
  if (!(await getHousehold(tx, householdId))) throw new NotFoundError("Family");
  const [open, unused] = await Promise.all([openInvoices(tx, householdId, branchId), unusedPayments(tx, householdId, branchId)]);
  return {
    open: open.map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, totalPaise: i.totalPaise, paidPaise: i.paidPaise, status: i.status, balancePaise: i.totalPaise - i.paidPaise })),
    advancePaise: sum(unused.map((u) => u.unused)),
  };
}

export type Receipt = {
  payment: Payment;
  householdName: string;
  collectorName: string | null;
  lines: ReceiptLine[];
  advancePaise: Paise;
  academy: { name: string; gstin: string | null; branch: string; address: string | null };
};

// The receipt as recorded: refunds, voids and later advance use never change it.
export async function receipt(tx: Tx, ctx: ScopedCtx, id: string): Promise<Receipt> {
  if (!allows(ctx, "payments:read") && !allows(ctx, "fees:collect")) throw new ForbiddenError("Not allowed: payments");
  const payment = await requirePayment(tx, ctx, id);
  const [lines, names, tenant, branch] = await Promise.all([receiptLines(tx, id), receiptNames(tx, payment), getOwnTenant(tx), getBranch(tx, payment.branchId)]);
  return {
    payment,
    ...names,
    lines,
    advancePaise: payment.amountPaise - sum(lines.map((l) => l.amountPaise)),
    academy: { name: tenant?.name ?? "", gstin: tenant?.gstin ?? null, branch: branch?.name ?? "", address: branch?.address ?? null },
  };
}

export type PaymentState = { refunds: Refund[]; refundablePaise: Paise; onInvoices: { invoiceId: string; number: string | null; net: Paise }[]; today: string };

// What has happened to a payment since: its refunds, what can still be refunded
// and which invoices its money is on now. Not part of the receipt.
export async function paymentState(tx: Tx, ctx: ScopedCtx, id: string, opts: { now?: Date } = {}): Promise<PaymentState> {
  if (!allows(ctx, "payments:read") && !allows(ctx, "fees:collect")) throw new ForbiddenError("Not allowed: payments");
  const p = await requirePayment(tx, ctx, id);
  const [given, onInvoices, { today }] = await Promise.all([refundsOf(tx, id), paidByPayment(tx, id), clock(tx, opts.now)]);
  const refundablePaise = p.status === "confirmed" ? p.amountPaise - sum(given.map((r) => r.amountPaise)) : 0n;
  return { refunds: given, refundablePaise, onInvoices, today };
}

// ---- the daily collection sheet (docs/04 "The daily reconciliation screen")

export type MethodTotal = { method: PaymentMethod; count: number; totalPaise: Paise };
export type CollectorTotal = { staffId: string | null; name: string; count: number; totalPaise: Paise };
export type CollectionSheet = {
  day: string;
  today: string;
  branch: { id: string; name: string };
  total: { count: number; totalPaise: Paise };
  byMethod: MethodTotal[];
  byCollector: CollectorTotal[];
  refunds: { totalPaise: Paise; byMethod: MethodTotal[]; rows: SheetRefund[] };
  cashInHandPaise: Paise;
  payments: SheetPayment[]; // cancelled ones are listed, not counted
};

// Money that came in: a later refund doesn't undo that it was received that day.
const COUNTED = new Set<Payment["status"]>(["confirmed", "refunded"]);

function byMethod(rows: { method: PaymentMethod; amountPaise: Paise }[]): MethodTotal[] {
  return PAYMENT_METHODS.map((method) => {
    const of = rows.filter((r) => r.method === method);
    return { method, count: of.length, totalPaise: sum(of.map((r) => r.amountPaise)) };
  }).filter((m) => m.count > 0);
}

// One branch, one day, counted by the day a payment was recorded in the
// academy's timezone, so a day already checked never changes (docs/03 §9).
export async function collectionSheet(tx: Tx, ctx: ScopedCtx, input: { branchId: string; day?: string }, opts: { now?: Date } = {}): Promise<CollectionSheet> {
  assertCan(ctx, "payments:read");
  await requireBranch(tx, ctx, input.branchId);
  const { today } = await clock(tx, opts.now);
  const day = input.day ?? today;
  if (!isIsoDate(day)) throw new BadRequestError("Pick a date");
  const [branch, rows, refunded] = await Promise.all([getBranch(tx, input.branchId), paymentsRecordedOn(tx, input.branchId, day), refundsOn(tx, input.branchId, day)]);
  const counted = rows.filter((p) => COUNTED.has(p.status));
  const collectors = new Map<string, CollectorTotal>();
  for (const p of counted) {
    const key = p.receivedBy ?? "";
    const c = collectors.get(key) ?? { staffId: p.receivedBy, name: p.collectorName ?? "Online", count: 0, totalPaise: 0n };
    collectors.set(key, { ...c, count: c.count + 1, totalPaise: c.totalPaise + p.amountPaise });
  }
  const cash = (xs: { method: PaymentMethod; amountPaise: Paise }[]) => sum(xs.filter((x) => x.method === "cash").map((x) => x.amountPaise));
  return {
    day,
    today,
    branch: { id: input.branchId, name: branch?.name ?? "" },
    total: { count: counted.length, totalPaise: sum(counted.map((p) => p.amountPaise)) },
    byMethod: byMethod(counted),
    byCollector: [...collectors.values()].sort((a, b) => (a.totalPaise === b.totalPaise ? a.name.localeCompare(b.name) : a.totalPaise > b.totalPaise ? -1 : 1)),
    refunds: { totalPaise: sum(refunded.map((r) => r.amountPaise)), byMethod: byMethod(refunded), rows: refunded },
    cashInHandPaise: cash(counted) - cash(refunded),
    payments: rows,
  };
}

// For the dashboard: what came in today in the viewer's branches.
export async function collectedToday(tx: Tx, ctx: ScopedCtx, opts: { now?: Date } = {}): Promise<{ count: number; total: Paise }> {
  assertCan(ctx, "payments:read");
  const { today } = await clock(tx, opts.now);
  return collectedOn(tx, ctx.branchIds, today);
}

// The receipts that paid an invoice, for the invoice page.
export async function invoiceReceipts(tx: Tx, ctx: ScopedCtx, invoiceId: string): Promise<InvoiceReceipt[]> {
  assertCan(ctx, "invoices:read");
  if (!(await getInvoice(tx, ctx.branchIds, invoiceId))) throw new NotFoundError("Invoice");
  return receiptsOnInvoice(tx, invoiceId);
}
