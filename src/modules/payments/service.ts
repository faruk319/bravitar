import { z } from "zod";
import { allows, assertCan, ForbiddenError } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, isIsoDate, periodLabel, todayIn } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { financialYear } from "@/lib/money/fy";
import { type Paise, sum } from "@/lib/money/paise";
import { currentEnrollmentsOf } from "@/modules/enrollments/repo";
import type { Actor } from "@/modules/fees/invoicing";
import { getInvoice, type LineRow, linesOf, payerNames } from "@/modules/fees/repo";
import type { FeePlan, Invoice } from "@/modules/fees/schema";
import { afterPayment } from "@/modules/messaging/reminders";
import { skipAbout } from "@/modules/messaging/repo";
import { allocateNumber } from "@/modules/numbering/repo";
import { type Payer, payerKey, payerOf, planPayer } from "@/modules/students/payer";
import { RELATION_LABELS } from "@/modules/students/relations";
import { activeStudentsOf, getStudent, guardiansOfMembers, leadGuardians } from "@/modules/students/repo";
import { getBranch, getOwnTenant, listBranches } from "@/modules/tenancy/repo";
import { oldestFirst, picked, refundFrom } from "./allocation";
import {
  collectedOn,
  getPayment,
  insertPayment,
  insertRefund,
  lockPayer,
  lockPayerOf,
  memberHeader,
  memberIdsWithSiblings,
  lockPayment,
  moveMoney,
  openInvoices,
  openInvoicesOfMembers,
  payerInScope,
  payerOfRow,
  payersOfMembers,
  paidByPayment,
  paymentByGatewayId,
  paymentByRequest,
  paymentMoney,
  paymentsOnInvoice,
  type InvoiceReceipt,
  paymentsRecordedOn,
  type ReceiptLine,
  receiptLines,
  receiptNames,
  receiptsOnInvoice,
  refundByGatewayId,
  refundsOf,
  refundsOn,
  type SheetPayment,
  type SheetRefund,
  unusedPayments,
  unusedPaymentsOfPayers,
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

// Agreed 2026-09-25: online payments are refunded in Razorpay and recorded from its webhook.
export const ONLINE_REFUND = "Online payments are refunded in your Razorpay dashboard; the refund shows here by itself.";

// What staff record by hand (card is a swipe machine). Online payments come from the gateway (Prompt 16).
export const HAND_METHODS = ["cash", "upi", "card", "bank_transfer", "cheque"] as const;
export const BACKDATE_DAYS = 7;

const inScope = (ctx: ScopedCtx, branchId: string) => !ctx.branchIds.length || ctx.branchIds.includes(branchId);
const isUuid = (v: string) => z.uuid().safeParse(v).success;

async function clock(tx: Tx, now: Date = new Date()): Promise<{ now: Date; today: string; fyStartMonth: number; gst: boolean }> {
  const t = await getOwnTenant(tx);
  return { now, today: todayIn(t?.timezone ?? "Asia/Kolkata", now), fyStartMonth: t?.fyStartMonth ?? 4, gst: Boolean(t?.gstin) };
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
  memberId: z.uuid(), // the member the collect screen was opened on; the siblings who share a guardian come with them
  branchId: z.uuid(),
  amountPaise: paise,
  method: z.enum(HAND_METHODS).default("cash"),
  reference: z.string().trim().max(80).optional(),
  receivedOn: isoDate.optional(),
  notes: z.string().trim().max(300).optional(),
  allocations: z.array(z.object({ invoiceId: z.uuid(), amountPaise: paise })).max(100).optional(),
  payerGuardianId: z.uuid().optional(), // who is paying; left out, it is the payer of the invoices ticked or the only one with dues
  payerMemberId: z.uuid().optional(),
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

export type DueRow = OpenInvoiceRow & { description: string; students: string[] };
export type PlanLine = { enrollmentId: string; studentName: string; programName: string; batchName: string; planName: string; kind: FeePlan["kind"]; cycle: FeePlan["billingCycle"]; amountPaise: Paise };
// One person who might be paying: what they owe in the branch (oldest first), the advance they hold there and the plans they pay for.
// relation reads "Mother", "Father"...: the guardian's to the opened member, else to a sibling; null for a member paying for themselves.
export type PayerOption = { key: string; payer: Payer; name: string; relation: string | null; open: DueRow[]; advancePaise: Paise; plans: PlanLine[] };
export type CollectScreen = {
  memberId: string;
  memberName: string;
  memberCode: string;
  branchId: string;
  branchName: string;
  today: string;
  earliest: string;
  payers: PayerOption[];
  defaultPayerKey: string | null; // the payer to pre-select; null means ask who is paying
  gst: boolean;
  enrollments: { id: string; programId: string; programName: string; batchName: string }[]; // the opened member's, for a charge to name a program
};

// What an open invoice is for, from its lines: "Swimming Beginner · Oct 2026".
const dueWhat = (lines: LineRow[]): string => [...new Set(lines.map((l) => [l.description, periodLabel(l.periodStart, l.periodEnd)].filter(Boolean).join(" · ")))].join(", ");

// Everything the collect screen needs for one member (and their siblings) at one branch: each payer
// with their own dues, advance and plans, and the one to pre-select.
export async function collectScreen(tx: Tx, ctx: ScopedCtx, memberId: string, branchId: string, opts: { now?: Date } = {}): Promise<CollectScreen> {
  assertCan(ctx, "fees:collect");
  await requireBranch(tx, ctx, branchId);
  const [member, branch, { today, fyStartMonth, gst }] = await Promise.all([memberHeader(tx, memberId), getBranch(tx, branchId), clock(tx, opts.now)]);
  if (!member) throw new NotFoundError("Member");
  const memberIds = await memberIdsWithSiblings(tx, memberId);
  const [open, candidates, live, own, placed, lead] = await Promise.all([
    openInvoicesOfMembers(tx, memberIds, branchId),
    payersOfMembers(tx, memberIds),
    guardiansOfMembers(tx, memberIds),
    guardiansOfMembers(tx, [memberId]),
    currentEnrollmentsOf(tx, memberIds),
    leadGuardians(tx, memberIds),
  ]);
  const [names, lines, held] = await Promise.all([
    payerNames(tx, candidates),
    linesOf(tx, open.map((i) => i.id)),
    Promise.all(candidates.map(async (p) => sum((await unusedPayments(tx, p, branchId)).map((u) => u.unused)))),
  ]);

  const dues = new Map<string, DueRow[]>();
  for (const i of open) {
    const its = lines.filter((l) => l.invoiceId === i.id);
    const row = { ...openRow(i), description: dueWhat(its), students: [...new Set(its.flatMap((l) => (l.studentName ? [l.studentName] : [])))] };
    const key = payerKey(payerOfRow(i));
    dues.set(key, [...(dues.get(key) ?? []), row]);
  }

  // A plan is listed under whoever is billed for it; a row with both payer columns set is skipped, as billing skips it.
  const plans = new Map<string, PlanLine[]>();
  for (const { e, plan, studentName, branchId: studentBranch, programName, batchName } of placed) {
    if (!plan || studentBranch !== branchId) continue;
    let payer: Payer;
    try {
      payer = planPayer(e, lead.get(e.studentId));
    } catch {
      continue;
    }
    const key = payerKey(payer);
    plans.set(key, [...(plans.get(key) ?? []), { enrollmentId: e.id, studentName, programName, batchName, planName: plan.name, kind: plan.kind, cycle: plan.billingCycle, amountPaise: plan.amountPaise }]);
  }

  // Who is likely paying: whoever owes; with nobody owing, the members' guardians, else the member themselves.
  const owing = candidates.filter((p) => dues.has(payerKey(p)));
  const likely: Payer[] = owing.length ? owing : live.length ? live.map((g): Payer => ({ kind: "guardian", guardianId: g.id })) : [{ kind: "member", memberId }];
  const likelyKeys = new Set(likely.map(payerKey));
  const [only] = likely;
  const relations = new Map([...live, ...own].map((g) => [g.id, RELATION_LABELS[g.relation]] as const)); // the opened member's own link wins

  const payers = candidates
    .map((payer, n): PayerOption => {
      const key = payerKey(payer);
      return { key, payer, name: names.get(key) ?? "", relation: payer.kind === "guardian" ? (relations.get(payer.guardianId) ?? null) : null, open: dues.get(key) ?? [], advancePaise: held[n] ?? 0n, plans: plans.get(key) ?? [] };
    })
    .filter((p) => likelyKeys.has(p.key) || p.advancePaise > 0n)
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return {
    memberId,
    memberName: member.name,
    memberCode: member.code,
    branchId,
    branchName: branch?.name ?? "",
    today,
    earliest: receivedOnRange(today, fyStartMonth).earliest,
    payers,
    defaultPayerKey: likely.length === 1 && only ? payerKey(only) : null,
    gst,
    enrollments: placed.filter((p) => p.e.studentId === memberId).map((p) => ({ id: p.e.id, programId: p.programId, programName: p.programName, batchName: p.batchName })),
  };
}

// Whom the collect drawer opens on: an invoice's member with that invoice ticked, else a student at their branch.
// Neither asked for is null: the drawer finds the member first.
export async function collectTarget(tx: Tx, ctx: ScopedCtx, q: { studentId?: string; invoiceId?: string }): Promise<{ memberId: string; branchId: string; preselect: string[] } | null> {
  assertCan(ctx, "fees:collect");
  if (q.invoiceId) {
    const inv = isUuid(q.invoiceId) ? await getInvoice(tx, ctx.branchIds, q.invoiceId) : undefined;
    if (!inv) throw new NotFoundError("Invoice");
    return { memberId: inv.studentId, branchId: inv.branchId, preselect: [inv.id] };
  }
  if (q.studentId) {
    const s = isUuid(q.studentId) ? await getStudent(tx, { branchIds: ctx.branchIds }, q.studentId) : undefined;
    if (!s) throw new NotFoundError("Student");
    return { memberId: s.id, branchId: s.branchId, preselect: [] };
  }
  return null;
}

// The collect screen is opened on one member; memberIdsWithSiblings turns that into the members
// whose fees are collected. Everything below goes by those members, the payer, or a guardian link.

// A payment has exactly one payer, and only ever pays that payer's invoices:
// money never crosses payers. It is the payer asked for, else the payer of the
// invoices ticked (they must all agree), else the members' only guardian, else the
// only member. Who owes is never taken to be who is paying; never guessed between several.
async function payerOfPayment(tx: Tx, data: z.output<typeof paymentSchema>, memberIds: string[]): Promise<Payer> {
  if (data.payerGuardianId && data.payerMemberId) throw new BadRequestError("Pick one payer");
  const asked: Payer | undefined = data.payerGuardianId ? { kind: "guardian", guardianId: data.payerGuardianId } : data.payerMemberId ? { kind: "member", memberId: data.payerMemberId } : undefined;
  // Only invoices ticked name a payer. Who happens to owe is not who is paying: an advance for the mother must not land on the father.
  const open = data.allocations ? await openInvoicesOfMembers(tx, memberIds, data.branchId) : [];
  const ticked = open.filter((i) => data.allocations?.some((a) => a.invoiceId === i.id));
  const payers = new Map(ticked.map((i) => [payerKey(payerOfRow(i)), payerOfRow(i)] as const));
  if (asked) {
    if (data.allocations && [...payers.keys()].some((k) => k !== payerKey(asked))) throw new BadRequestError("Those invoices are billed to someone else");
    if (!(await payerInScope(tx, memberIds, asked))) throw new BadRequestError("That payer isn't one of these members' payers");
    return asked;
  }
  if (payers.size > 1) throw new BadRequestError("These invoices are billed to different people. Record one payment for each.");
  const [found] = payers.values();
  if (found) return found;
  const lead = await guardiansOfMembers(tx, memberIds);
  const [only] = lead;
  if (lead.length === 1 && only) return { kind: "guardian", guardianId: only.id };
  const [member] = memberIds;
  if (!lead.length && memberIds.length === 1 && member) return { kind: "member", memberId: member };
  throw new BadRequestError("Say who is paying");
}

// The same payment sent again: same branch and amount, a payer of these members, and the payer asked for, if any, the one recorded.
async function isReplay(tx: Tx, again: Payment, data: z.output<typeof paymentSchema>, memberIds: string[]): Promise<boolean> {
  if (again.branchId !== data.branchId || again.amountPaise !== data.amountPaise) return false;
  const recorded = payerOfRow(again);
  const asked = data.payerGuardianId ?? data.payerMemberId;
  if (asked && asked !== (recorded.kind === "guardian" ? recorded.guardianId : recorded.memberId)) return false;
  return payerInScope(tx, memberIds, recorded);
}

// What the payer owes in a branch across all their members; a receipt's balance after is this less what it pays.
async function owedBy(tx: Tx, payer: Payer, branchId: string): Promise<Paise> {
  return sum((await openInvoices(tx, payer, branchId)).map((i) => i.totalPaise - i.paidPaise));
}

// Oldest invoice first unless invoices are picked; what is left is the family's
// advance in this branch. The receipt number is taken in this transaction, so a
// failure gives it back.
export async function recordPayment(tx: Tx, ctx: ScopedCtx, input: PaymentInput, opts: { now?: Date } = {}): Promise<Payment> {
  assertCan(ctx, "fees:collect");
  const data = paymentSchema.parse(input);
  await requireBranch(tx, ctx, data.branchId);
  const member = await memberHeader(tx, data.memberId);
  if (!member) throw new NotFoundError("Member");
  const { today, fyStartMonth } = await clock(tx, opts.now);
  const receivedOn = data.receivedOn ?? today;
  checkReceivedOn(receivedOn, today, fyStartMonth);

  // A retry is the same payment, so its payer is the one already recorded; the invoices it paid are no longer open to name one.
  // An issued invoice's payer never changes, so the payer is safe to read before the lock.
  const memberIds = await memberIdsWithSiblings(tx, data.memberId);
  const earlier = await paymentByRequest(tx, data.requestId);
  const payer = earlier ? payerOfRow(earlier) : await payerOfPayment(tx, data, memberIds);
  await lockPayer(tx, payer);
  // Checked under the lock, so a double tap waits for the first and returns it.
  const again = await paymentByRequest(tx, data.requestId);
  if (again) {
    if (!(await isReplay(tx, again, data, memberIds))) throw new ConflictError("This form was already used for a different payment");
    return again;
  }
  // Only the invoices the screen showed: a shared payer's other family is settled on its own screen.
  const open = (await openInvoices(tx, payer, data.branchId, memberIds)).map((i) => ({ invoiceId: i.id, balance: i.totalPaise - i.paidPaise }));
  const split = data.allocations ? picked(data.amountPaise, open, data.allocations) : oldestFirst(data.amountPaise, open);
  const fy = financialYear(today, fyStartMonth);
  const receiptNumber = await allocateNumber(tx, ctx.tenantId, "receipt", fy);
  const billToName = (await payerNames(tx, [payer])).get(payerKey(payer));
  if (!billToName) throw new ConflictError("This payer has no name on record");
  const owedBefore = await owedBy(tx, payer, data.branchId);
  const payment = await insertPayment(tx, {
    tenantId: ctx.tenantId,
    branchId: data.branchId,
    payerGuardianId: payer.kind === "guardian" ? payer.guardianId : null,
    payerMemberId: payer.kind === "member" ? payer.memberId : null,
    billToName,
    balanceAfterPaise: owedBefore - sum(split.shares.map((s) => s.amountPaise)),
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
      payerGuardianId: payment.payerGuardianId,
      payerMemberId: payment.payerMemberId,
      billToName,
      invoices: split.shares.map((s) => ({ invoiceId: s.invoiceId, amountPaise: text(s.amountPaise) })),
      advancePaise: text(split.advance),
    },
  });
  await afterPayment(tx, payment, split.shares.map((s) => s.invoiceId), opts);
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
  await lockPayerOf(tx, found);
  const p = await lockPayment(tx, id);
  if (p.status === "cancelled") throw new ConflictError("Already cancelled");
  if (p.method === "online") throw new ConflictError(ONLINE_REFUND);
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
  await skipAbout(tx, "payment", [id], "The payment was cancelled");
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
  await lockPayerOf(tx, found);
  const p = await lockPayment(tx, id);
  if (p.status === "cancelled") throw new ConflictError("A cancelled payment can't be refunded");
  if (p.method === "online") throw new ConflictError(ONLINE_REFUND);
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

// The payer's unused money in a branch pays that payer's open invoices, oldest
// money to the oldest invoice, never another payer's. Runs when invoices are
// issued (docs/03 §9).
export async function applyAdvance(tx: Tx, by: Actor, payer: Payer, branchId: string): Promise<Paise> {
  await lockPayer(tx, payer);
  const [unused, open] = await Promise.all([unusedPayments(tx, payer, branchId), openInvoices(tx, payer, branchId)]);
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

export const applyAdvanceSchema = z.object({ branchId: z.uuid(), payerGuardianId: z.uuid().optional(), payerMemberId: z.uuid().optional() });

// "Use advance now": the payer's unused money pays their open invoices in the branch, oldest first,
// without waiting for the next invoice to be issued. applyAdvance audits each move.
export async function applyAdvanceNow(tx: Tx, ctx: ScopedCtx, input: z.input<typeof applyAdvanceSchema>): Promise<{ appliedPaise: Paise }> {
  assertCan(ctx, "fees:collect");
  const data = applyAdvanceSchema.parse(input);
  const payer: Payer | undefined = data.payerGuardianId && !data.payerMemberId ? { kind: "guardian", guardianId: data.payerGuardianId } : data.payerMemberId && !data.payerGuardianId ? { kind: "member", memberId: data.payerMemberId } : undefined;
  if (!payer) throw new BadRequestError("Pick one payer");
  await requireBranch(tx, ctx, data.branchId);
  return { appliedPaise: await applyAdvance(tx, actor(ctx), payer, data.branchId) };
}

// Voiding an invoice with money on it: each payment's money comes off as a
// 'void' row and is the family's advance again (docs/03 §6). Nothing is deleted.
export async function releaseInvoice(tx: Tx, by: Actor, invoice: Pick<Invoice, "id" | "payerGuardianId" | "payerMemberId">): Promise<Paise> {
  await lockPayerOf(tx, invoice);
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

const openRow = (i: Invoice): OpenInvoiceRow => ({ id: i.id, number: i.number, dueDate: i.dueDate, totalPaise: i.totalPaise, paidPaise: i.paidPaise, status: i.status, balancePaise: i.totalPaise - i.paidPaise });

// A member and their siblings (members sharing a guardian) in one branch, all payers together:
// open invoices, oldest first, and the advance (docs/03 §9: visible on the family). The student page shows it.
export async function familyAccount(tx: Tx, ctx: ScopedCtx, memberId: string, branchId: string): Promise<FamilyAccount> {
  if (!allows(ctx, "fees:collect") && !allows(ctx, "invoices:read")) throw new ForbiddenError("Not allowed: fees");
  await requireBranch(tx, ctx, branchId);
  if (!(await memberHeader(tx, memberId))) throw new NotFoundError("Member");
  const memberIds = await memberIdsWithSiblings(tx, memberId);
  const [open, unused] = await Promise.all([openInvoicesOfMembers(tx, memberIds, branchId), payersOfMembers(tx, memberIds).then((payers) => unusedPaymentsOfPayers(tx, payers, branchId))]);
  return {
    open: open.map(openRow),
    advancePaise: sum(unused.map((u) => u.unused)),
  };
}

export type Receipt = {
  payment: Payment;
  billToName: string;
  collectorName: string | null;
  lines: ReceiptLine[];
  students: string[]; // whom the money was for
  advancePaise: Paise;
  balanceAfterPaise: Paise | null; // what the payer still owed after it, as recorded; null on older receipts
  academy: { name: string; gstin: string | null; branch: string; address: string | null };
};

// The receipt as recorded: refunds, voids and later advance use never change it.
export async function receipt(tx: Tx, ctx: ScopedCtx, id: string): Promise<Receipt> {
  if (!allows(ctx, "payments:read") && !allows(ctx, "fees:collect")) throw new ForbiddenError("Not allowed: payments");
  return receiptOf(tx, await requirePayment(tx, ctx, id));
}

// Also what the family's private link shows; callers check access.
export async function receiptOf(tx: Tx, payment: Payment): Promise<Receipt> {
  const [lines, names, tenant, branch] = await Promise.all([receiptLines(tx, payment.id), receiptNames(tx, payment), getOwnTenant(tx), getBranch(tx, payment.branchId)]);
  // The students on the invoices it paid; with none (all advance), the payer's children in its branch, where the advance sits.
  const whom = lines.length ? lines.flatMap((l) => l.items.map((i) => i.studentName)) : (await activeStudentsOf(tx, { branchIds: [payment.branchId] }, [payerOfRow(payment)])).map((a) => a.student.fullName);
  return {
    payment,
    ...names,
    lines,
    students: [...new Set(whom.filter((n) => n !== null))].sort((a, b) => a.localeCompare(b)),
    advancePaise: payment.amountPaise - sum(lines.map((l) => l.amountPaise)),
    balanceAfterPaise: payment.balanceAfterPaise,
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
// What counts as money collected: a cancelled payment never does.
export const COUNTED = new Set<Payment["status"]>(["confirmed", "refunded"]);

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

// Collections for someone who collects without payments:read: the receipts they recorded today, in their branches.
export async function myReceiptsToday(tx: Tx, ctx: ScopedCtx, opts: { now?: Date } = {}): Promise<SheetPayment[]> {
  assertCan(ctx, "fees:collect");
  const { today } = await clock(tx, opts.now);
  const branchIds = ctx.branchIds.length ? ctx.branchIds : (await listBranches(tx)).map((b) => b.id);
  const rows = (await Promise.all(branchIds.map((b) => paymentsRecordedOn(tx, b, today, ctx.staffId)))).flat();
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
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

export type InvoiceReceiptRow = InvoiceReceipt & { invoiceId: string };

// Receipts on several invoices of one student, newest first; an invoice outside the viewer's branches adds none.
export async function receiptsOfInvoices(tx: Tx, ctx: ScopedCtx, invoiceIds: string[]): Promise<InvoiceReceiptRow[]> {
  assertCan(ctx, "invoices:read");
  const out: InvoiceReceiptRow[] = [];
  for (const invoiceId of invoiceIds) {
    if (!(await getInvoice(tx, ctx.branchIds, invoiceId))) continue;
    for (const r of await receiptsOnInvoice(tx, invoiceId)) out.push({ ...r, invoiceId });
  }
  return out.sort((a, b) => (a.receivedOn < b.receivedOn ? 1 : a.receivedOn > b.receivedOn ? -1 : 0));
}

// ---- payments and refunds through Razorpay (docs/04 "Razorpay payment link flow")

const system = (tenantId: string) => ({ actorType: "system" as const, tenantId });

// A webhook must never fail on a name: the payer's, else the member's (invoices.student_id is NOT NULL).
async function gatewayPayerName(tx: Tx, inv: Invoice): Promise<string> {
  const payer = payerOf(inv);
  const member: Payer = { kind: "member", memberId: inv.studentId };
  const names = await payerNames(tx, payer ? [payer, member] : [member]);
  return (payer && names.get(payerKey(payer))) || names.get(payerKey(member)) || "";
}

// A paid link, recorded once per Razorpay payment id whichever event brings it:
// method Online, no collector, the next receipt number, received on the day
// Razorpay captured it, counted on the day recorded. It pays the invoice up to
// its balance; anything over is the family's advance.
export async function recordGatewayPayment(
  tx: Tx,
  input: { invoiceId: string; gatewayPaymentId: string; amountPaise: Paise; capturedAt: Date },
  opts: { now?: Date } = {},
): Promise<{ payment: Payment; created: boolean }> {
  const found = await getInvoice(tx, [], input.invoiceId);
  if (!found) throw new NotFoundError("Invoice");
  await lockPayerOf(tx, found);
  const again = await paymentByGatewayId(tx, input.gatewayPaymentId);
  if (again) return { payment: again, created: false };
  if (input.amountPaise <= 0n) throw new BadRequestError("A payment needs an amount");
  const inv = (await getInvoice(tx, [], input.invoiceId)) ?? found;
  const { today, fyStartMonth } = await clock(tx, opts.now);
  const { today: capturedOn } = await clock(tx, input.capturedAt);
  const receivedOn = capturedOn < today ? capturedOn : today;
  const open = inv.status === "issued" || inv.status === "part_paid" ? [{ invoiceId: inv.id, balance: inv.totalPaise - inv.paidPaise }] : [];
  const split = oldestFirst(input.amountPaise, open);
  const fy = financialYear(receivedOn, fyStartMonth);
  const receiptNumber = await allocateNumber(tx, inv.tenantId, "receipt", fy);
  const billToName = inv.billToName?.trim() || (await gatewayPayerName(tx, inv));
  const owedBefore = await owedBy(tx, payerOfRow(inv), inv.branchId);
  const payment = await insertPayment(tx, {
    tenantId: inv.tenantId,
    branchId: inv.branchId,
    payerGuardianId: inv.payerGuardianId,
    payerMemberId: inv.payerMemberId,
    billToName,
    balanceAfterPaise: owedBefore - sum(split.shares.map((s) => s.amountPaise)),
    receiptNumber,
    fy,
    method: "online",
    amountPaise: input.amountPaise,
    receivedOn,
    recordedOn: today,
    receivedBy: null,
    reference: input.gatewayPaymentId,
    gatewayPaymentId: input.gatewayPaymentId,
  });
  for (const s of split.shares) await moveMoney(tx, { tenantId: inv.tenantId, paymentId: payment.id, invoiceId: s.invoiceId, kind: "receipt", amountPaise: s.amountPaise, createdBy: null });
  await writeAudit(tx, {
    ...system(inv.tenantId),
    action: "payment.create",
    entityType: "payment",
    entityId: payment.id,
    after: { receiptNumber, amountPaise: text(input.amountPaise), method: "online", billToName, gatewayPaymentId: input.gatewayPaymentId, receivedOn, invoices: split.shares.map((s) => ({ invoiceId: s.invoiceId, amountPaise: text(s.amountPaise) })), advancePaise: text(split.advance) },
  });
  await afterPayment(tx, payment, split.shares.map((s) => s.invoiceId), opts);
  return { payment, created: true };
}

// A refund made in the Razorpay dashboard, recorded once per Razorpay refund id:
// out of the payment's advance first, then its invoices, which reopen. Returns
// why nothing was recorded when the refund doesn't fit the books.
export async function recordGatewayRefund(
  tx: Tx,
  input: { gatewayPaymentId: string; gatewayRefundId: string; amountPaise: Paise; refundedAt: Date },
  opts: { now?: Date } = {},
): Promise<{ refund?: Refund; problem?: string }> {
  const found = await paymentByGatewayId(tx, input.gatewayPaymentId);
  if (!found) return { problem: "not a payment recorded here" };
  await lockPayerOf(tx, found);
  const again = await refundByGatewayId(tx, input.gatewayRefundId);
  if (again) return { refund: again };
  const p = await lockPayment(tx, found.id);
  if (p.status !== "confirmed") return { problem: `the payment is ${p.status}` };
  const [{ allocated, refunded }, paid] = await Promise.all([paymentMoney(tx, p.id), paidByPayment(tx, p.id)]);
  let from: ReturnType<typeof refundFrom>;
  try {
    from = refundFrom(input.amountPaise, p.amountPaise - allocated - refunded, paid);
  } catch (e) {
    if (e instanceof BadRequestError) return { problem: e.message };
    throw e;
  }
  const { today } = await clock(tx, opts.now);
  const refund = await insertRefund(tx, {
    tenantId: p.tenantId,
    paymentId: p.id,
    amountPaise: input.amountPaise,
    method: "online",
    reference: input.gatewayRefundId,
    reason: "Refunded in Razorpay",
    refundedOn: today,
    approvedBy: null,
    refundedAt: input.refundedAt,
    gatewayRefundId: input.gatewayRefundId,
  });
  for (const s of from.fromInvoices) await moveMoney(tx, { tenantId: p.tenantId, paymentId: p.id, invoiceId: s.invoiceId, kind: "refund", amountPaise: -s.amountPaise, refundId: refund.id, createdBy: null });
  if (refunded + input.amountPaise === p.amountPaise) await updatePayment(tx, p.id, { status: "refunded" });
  await writeAudit(tx, {
    ...system(p.tenantId),
    action: "payment.refund",
    entityType: "payment",
    entityId: p.id,
    after: { refundId: refund.id, gatewayRefundId: input.gatewayRefundId, amountPaise: text(input.amountPaise), fromAdvancePaise: text(from.fromAdvance), fromInvoices: from.fromInvoices.map((s) => ({ invoiceId: s.invoiceId, amountPaise: text(s.amountPaise) })) },
  });
  return { refund };
}
