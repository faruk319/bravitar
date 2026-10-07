import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, type SQL, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import type { Paise } from "@/lib/money/paise";
import { payerIs } from "@/modules/fees/repo";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { staffUsers } from "@/modules/staff/schema";
import { type Payer, payerKey, payerOf } from "@/modules/students/payer";
import { guardiansOfMembers, payerContacts } from "@/modules/students/repo";
import { guardians, studentGuardians, students } from "@/modules/students/schema";
import { type AllocationKind, type LinkStatus, type Payment, type PaymentLink, paymentAllocations, paymentLinks, payments, type Refund, refunds } from "./schema";

// Every money move for a payer takes turns: recording, cancelling, refunding,
// using the advance and releasing a voided invoice. A payment only ever pays
// its own payer's invoices, so two payers touch disjoint rows and may move
// money at once. The two-key form never collides with the single-key
// invoicing lock, which is always taken first.
export async function lockPayer(tx: Tx, payer: Payer): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('money'), hashtext(${payerKey(payer)}))`);
}

// The payer of an invoice or payment row; one with none is corrupt, so refuse rather than lock the wrong thing.
export function payerOfRow(row: { payerGuardianId: string | null; payerMemberId: string | null }): Payer {
  const p = payerOf(row);
  if (!p) throw new Error("money row has no payer");
  return p;
}

export const lockPayerOf = (tx: Tx, row: { payerGuardianId: string | null; payerMemberId: string | null }): Promise<void> => lockPayer(tx, payerOfRow(row));

const paymentPayerIs = (p: Payer): SQL =>
  p.kind === "guardian" ? sql`${payments.payerGuardianId} = ${p.guardianId} AND ${payments.payerMemberId} IS NULL` : sql`${payments.payerMemberId} = ${p.memberId} AND ${payments.payerGuardianId} IS NULL`;

export async function insertPayment(tx: Tx, row: Omit<typeof payments.$inferInsert, "id">): Promise<Payment> {
  const [p] = await tx.insert(payments).values({ id: uuidv7(), ...row }).returning();
  if (!p) throw new Error("payment insert returned no row");
  return p;
}

// Only status and the cancel columns can change; the database refuses the rest.
export async function updatePayment(tx: Tx, id: string, patch: Partial<Pick<Payment, "status" | "cancelledAt" | "cancelledBy" | "cancelReason">>): Promise<Payment> {
  const [p] = await tx.update(payments).set(patch).where(eq(payments.id, id)).returning();
  if (!p) throw new Error("payment update matched no row");
  return p;
}

// branchIds empty = all branches.
const paymentScope = (branchIds: string[]): SQL | undefined => (branchIds.length ? inArray(payments.branchId, branchIds) : undefined);

export async function getPayment(tx: Tx, branchIds: string[], id: string): Promise<Payment | undefined> {
  const [p] = await tx.select().from(payments).where(and(eq(payments.id, id), paymentScope(branchIds)));
  return p;
}

export async function lockPayment(tx: Tx, id: string): Promise<Payment> {
  const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
  if (!p) throw new Error("payment lock matched no row");
  return p;
}

export async function paymentByRequest(tx: Tx, requestId: string): Promise<Payment | undefined> {
  const [p] = await tx.select().from(payments).where(eq(payments.requestId, requestId));
  return p;
}

// The one way money goes onto or comes off an invoice: a ledger row, and the
// invoice's paid amount and status moved by the same amount. Status follows
// paid against total (docs/02 §9 invariant 4); the database checks both.
export async function moveMoney(
  tx: Tx,
  row: { tenantId: string; paymentId: string; invoiceId: string; kind: AllocationKind; amountPaise: Paise; refundId?: string; createdBy: string | null },
): Promise<void> {
  await tx.insert(paymentAllocations).values({ id: uuidv7(), ...row });
  const paid = sql`${invoices.paidPaise} + ${row.amountPaise.toString()}::bigint`;
  await tx
    .update(invoices)
    .set({ paidPaise: paid, status: sql`CASE WHEN ${paid} = ${invoices.totalPaise} THEN 'paid' WHEN ${paid} = 0 THEN 'issued' ELSE 'part_paid' END` })
    .where(eq(invoices.id, row.invoiceId));
}

const openIn = (tx: Tx, where: SQL | undefined) =>
  tx
    .select()
    .from(invoices)
    .where(and(where, inArray(invoices.status, ["issued", "part_paid"])))
    .orderBy(asc(invoices.dueDate), asc(sql`length(${invoices.number})`), asc(invoices.number), asc(invoices.id));

// The payer's issued and part-paid invoices in one branch, oldest first: due
// date, then number (length first, so 10000 sorts after 9999). With memberIds, only those
// members' invoices: what a collect screen showed.
export async function openInvoices(tx: Tx, payer: Payer, branchId: string, memberIds?: string[]): Promise<Invoice[]> {
  if (memberIds && !memberIds.length) return [];
  return openIn(tx, and(payerIs(payer), eq(invoices.branchId, branchId), memberIds ? inArray(invoices.studentId, memberIds) : undefined));
}

// Open invoices of these members, whoever the payer: the member's fees, for the collect screen and to find who is paying.
export async function openInvoicesOfMembers(tx: Tx, memberIds: string[], branchId: string): Promise<Invoice[]> {
  if (!memberIds.length) return [];
  return openIn(tx, and(inArray(invoices.studentId, memberIds), eq(invoices.branchId, branchId)));
}

const allocatedTo = sql<string>`(SELECT coalesce(sum(a.amount_paise), 0) FROM app.payment_allocations a WHERE a.payment_id = ${payments.id})`;
const refundedFrom = sql<string>`(SELECT coalesce(sum(r.amount_paise), 0) FROM app.refunds r WHERE r.payment_id = ${payments.id})`;

const unusedWhere = async (tx: Tx, where: SQL | undefined): Promise<{ paymentId: string; unused: Paise }[]> => {
  const rows = await tx
    .select({ paymentId: payments.id, unused: sql<string>`(${payments.amountPaise} - ${allocatedTo} - ${refundedFrom})::text` })
    .from(payments)
    .where(and(where, eq(payments.status, "confirmed")))
    .orderBy(asc(payments.recordedOn), asc(payments.createdAt), asc(payments.id));
  return rows.map((r) => ({ paymentId: r.paymentId, unused: BigInt(r.unused) })).filter((r) => r.unused > 0n);
};

// Confirmed payments of the payer in a branch with money not yet on an
// invoice or refunded: the payer's advance, oldest payment first.
export const unusedPayments = (tx: Tx, payer: Payer, branchId: string) => unusedWhere(tx, and(paymentPayerIs(payer), eq(payments.branchId, branchId)));

// Unused money of the given payers, for showing on the collect screen only; nothing is applied from it.
export async function unusedPaymentsOfPayers(tx: Tx, payers: Payer[], branchId: string) {
  const guardianIds = payers.flatMap((p) => (p.kind === "guardian" ? [p.guardianId] : []));
  const memberIds = payers.flatMap((p) => (p.kind === "member" ? [p.memberId] : []));
  const whose = [guardianIds.length ? inArray(payments.payerGuardianId, guardianIds) : undefined, memberIds.length ? inArray(payments.payerMemberId, memberIds) : undefined].filter((w) => w !== undefined);
  return whose.length ? unusedWhere(tx, and(or(...whose), eq(payments.branchId, branchId))) : [];
}

// One payment's money: on invoices, refunded, and what's left unused.
export async function paymentMoney(tx: Tx, paymentId: string): Promise<{ allocated: Paise; refunded: Paise }> {
  const [r] = await tx.select({ allocated: sql<string>`${allocatedTo}::text`, refunded: sql<string>`${refundedFrom}::text` }).from(payments).where(eq(payments.id, paymentId));
  return { allocated: BigInt(r?.allocated ?? "0"), refunded: BigInt(r?.refunded ?? "0") };
}

// What one payment has on each invoice now (net of anything taken back), latest due first.
export async function paidByPayment(tx: Tx, paymentId: string): Promise<{ invoiceId: string; number: string | null; net: Paise }[]> {
  const net = sql<string>`sum(${paymentAllocations.amountPaise})`;
  const rows = await tx
    .select({ invoiceId: paymentAllocations.invoiceId, number: invoices.number, net: sql<string>`${net}::text` })
    .from(paymentAllocations)
    .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
    .where(eq(paymentAllocations.paymentId, paymentId))
    .groupBy(paymentAllocations.invoiceId, invoices.number, invoices.dueDate)
    .having(sql`${net} > 0`)
    .orderBy(desc(invoices.dueDate), desc(paymentAllocations.invoiceId));
  return rows.map((r) => ({ invoiceId: r.invoiceId, number: r.number, net: BigInt(r.net) }));
}

// Each payment's money on one invoice now, net.
export async function paymentsOnInvoice(tx: Tx, invoiceId: string): Promise<{ paymentId: string; net: Paise }[]> {
  const net = sql<string>`sum(${paymentAllocations.amountPaise})`;
  const rows = await tx
    .select({ paymentId: paymentAllocations.paymentId, net: sql<string>`${net}::text` })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.invoiceId, invoiceId))
    .groupBy(paymentAllocations.paymentId)
    .having(sql`${net} > 0`)
    .orderBy(asc(paymentAllocations.paymentId));
  return rows.map((r) => ({ paymentId: r.paymentId, net: BigInt(r.net) }));
}

export async function insertRefund(tx: Tx, row: Omit<typeof refunds.$inferInsert, "id">): Promise<Refund> {
  const [r] = await tx.insert(refunds).values({ id: uuidv7(), ...row }).returning();
  if (!r) throw new Error("refund insert returned no row");
  return r;
}

export async function refundsOf(tx: Tx, paymentId: string): Promise<Refund[]> {
  return tx.select().from(refunds).where(eq(refunds.paymentId, paymentId)).orderBy(asc(refunds.refundedAt), asc(refunds.id));
}

export type ReceiptLine = { invoiceId: string; number: string | null; amountPaise: Paise };

// What the payment paid when it was recorded. Later refunds, voids and
// advance use add other kinds of rows, so the receipt never changes.
export async function receiptLines(tx: Tx, paymentId: string): Promise<ReceiptLine[]> {
  return tx
    .select({ invoiceId: paymentAllocations.invoiceId, number: invoices.number, amountPaise: paymentAllocations.amountPaise })
    .from(paymentAllocations)
    .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
    .where(and(eq(paymentAllocations.paymentId, paymentId), eq(paymentAllocations.kind, "receipt")))
    .orderBy(asc(invoices.dueDate), asc(sql`length(${invoices.number})`), asc(invoices.number));
}

// "Received from", frozen when the receipt was made: the name written to the
// audit row of the payment (append-only), else the invoice it paid, else the
// payer's name today for receipts that predate it.
const livePayerName = sql`CASE WHEN app.payments.payer_guardian_id IS NOT NULL THEN (SELECT g.full_name FROM app.guardians g WHERE g.id = app.payments.payer_guardian_id)
  ELSE (SELECT s.full_name FROM app.students s WHERE s.id = app.payments.payer_member_id) END`;
const receivedFrom = sql<string>`coalesce(
  (SELECT a.after ->> 'billToName' FROM app.audit_log a WHERE a.entity_type = 'payment' AND a.entity_id = app.payments.id AND a.action = 'payment.create' ORDER BY a.id LIMIT 1),
  (SELECT i.bill_to_name FROM app.payment_allocations pa JOIN app.invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = app.payments.id AND pa.kind = 'receipt' AND i.bill_to_name IS NOT NULL ORDER BY pa.created_at, pa.id LIMIT 1),
  ${livePayerName},
  '')`;

export async function receiptNames(tx: Tx, p: Payment): Promise<{ householdName: string; collectorName: string | null }> {
  const [r] = await tx.select({ name: receivedFrom }).from(payments).where(eq(payments.id, p.id));
  const [s] = p.receivedBy ? await tx.select({ name: staffUsers.fullName }).from(staffUsers).where(eq(staffUsers.id, p.receivedBy)) : [];
  return { householdName: r?.name ?? "", collectorName: s?.name ?? null };
}

// ---- the collection sheet (docs/04 "The daily reconciliation screen")

export type SheetPayment = Pick<Payment, "id" | "receiptNumber" | "amountPaise" | "method" | "reference" | "receivedOn" | "recordedOn" | "status" | "cancelReason" | "receivedBy" | "createdAt"> & {
  householdName: string;
  collectorName: string | null;
};

const recorded = (tx: Tx, where: SQL | undefined) =>
  tx
    .select({
      id: payments.id,
      receiptNumber: payments.receiptNumber,
      amountPaise: payments.amountPaise,
      method: payments.method,
      reference: payments.reference,
      receivedOn: payments.receivedOn,
      recordedOn: payments.recordedOn,
      status: payments.status,
      cancelReason: payments.cancelReason,
      receivedBy: payments.receivedBy,
      createdAt: payments.createdAt,
      householdName: receivedFrom,
      collectorName: staffUsers.fullName,
    })
    .from(payments)
    .leftJoin(staffUsers, eq(staffUsers.id, payments.receivedBy))
    .where(where)
    .orderBy(asc(payments.recordedOn), asc(payments.createdAt), asc(payments.id));

// One branch's payments recorded on a day, cancelled ones too, in the order taken.
export async function paymentsRecordedOn(tx: Tx, branchId: string, day: string): Promise<SheetPayment[]> {
  return recorded(tx, and(eq(payments.branchId, branchId), eq(payments.recordedOn, day)));
}

// The collection register: every day in [from, to] in the viewer's branches.
export async function paymentsRecordedBetween(tx: Tx, branchIds: string[], from: string, to: string): Promise<SheetPayment[]> {
  return recorded(tx, and(paymentScope(branchIds), gte(payments.recordedOn, from), lte(payments.recordedOn, to)));
}

export type SheetRefund = Pick<Refund, "id" | "paymentId" | "amountPaise" | "method" | "reason" | "refundedAt"> & { receiptNumber: string; householdName: string };

// Money paid back on a day against one branch's payments.
export async function refundsOn(tx: Tx, branchId: string, day: string): Promise<SheetRefund[]> {
  return tx
    .select({
      id: refunds.id,
      paymentId: refunds.paymentId,
      amountPaise: refunds.amountPaise,
      method: refunds.method,
      reason: refunds.reason,
      refundedAt: refunds.refundedAt,
      receiptNumber: payments.receiptNumber,
      householdName: receivedFrom,
    })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(and(eq(payments.branchId, branchId), eq(refunds.refundedOn, day)))
    .orderBy(asc(refunds.refundedAt), asc(refunds.id));
}

// Money taken in per day across branches (empty = all), the days with any.
export async function collectedByDay(tx: Tx, branchIds: string[], from: string, to: string): Promise<{ day: string; count: number; total: Paise }[]> {
  const rows = await tx
    .select({ day: payments.recordedOn, count: sql<number>`count(*)::int`, total: sql<string>`sum(${payments.amountPaise})::text` })
    .from(payments)
    .where(and(gte(payments.recordedOn, from), lte(payments.recordedOn, to), inArray(payments.status, ["confirmed", "refunded"]), paymentScope(branchIds)))
    .groupBy(payments.recordedOn)
    .orderBy(asc(payments.recordedOn));
  return rows.map((r) => ({ day: r.day, count: r.count, total: BigInt(r.total) }));
}

export async function collectedOn(tx: Tx, branchIds: string[], day: string): Promise<{ count: number; total: Paise }> {
  const [r] = await collectedByDay(tx, branchIds, day, day);
  return { count: r?.count ?? 0, total: r?.total ?? 0n };
}

// The revenue chart: one row per calendar month in [from, to], by recorded date.
export async function collectedByMonth(tx: Tx, branchIds: string[], from: string, to: string): Promise<{ month: string; count: number; total: Paise }[]> {
  const month = sql<string>`to_char(${payments.recordedOn}, 'YYYY-MM')`;
  const rows = await tx
    .select({ month, count: sql<number>`count(*)::int`, total: sql<string>`sum(${payments.amountPaise})::text` })
    .from(payments)
    .where(and(gte(payments.recordedOn, from), lte(payments.recordedOn, to), inArray(payments.status, ["confirmed", "refunded"]), paymentScope(branchIds)))
    .groupBy(month)
    .orderBy(asc(month));
  return rows.map((r) => ({ month: r.month, count: r.count, total: BigInt(r.total) }));
}

export type InvoiceReceipt = Pick<Payment, "receiptNumber" | "receivedOn" | "method"> & { paymentId: string; net: Paise };

// The payments that have money on an invoice now, oldest first.
export async function receiptsOnInvoice(tx: Tx, invoiceId: string): Promise<InvoiceReceipt[]> {
  const net = sql<string>`sum(${paymentAllocations.amountPaise})`;
  const rows = await tx
    .select({ paymentId: payments.id, receiptNumber: payments.receiptNumber, receivedOn: payments.receivedOn, method: payments.method, net: sql<string>`${net}::text` })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(eq(paymentAllocations.invoiceId, invoiceId))
    .groupBy(payments.id, payments.receiptNumber, payments.receivedOn, payments.method)
    .having(sql`${net} > 0`)
    .orderBy(asc(payments.receivedOn), asc(payments.id));
  return rows.map((r) => ({ ...r, net: BigInt(r.net) }));
}

// ---- Razorpay payment links (docs/03 §9, agreed 2026-09-25)

export async function liveLink(tx: Tx, invoiceId: string): Promise<PaymentLink | undefined> {
  const [l] = await tx.select().from(paymentLinks).where(and(eq(paymentLinks.invoiceId, invoiceId), eq(paymentLinks.status, "created")));
  return l;
}

export async function insertLink(tx: Tx, row: typeof paymentLinks.$inferInsert): Promise<PaymentLink> {
  const [l] = await tx.insert(paymentLinks).values(row).returning();
  if (!l) throw new Error("payment link insert returned no row");
  return l;
}

export async function closeLink(tx: Tx, id: string, status: Exclude<LinkStatus, "created">, at: Date): Promise<void> {
  await tx.update(paymentLinks).set({ status, closedAt: at }).where(and(eq(paymentLinks.id, id), eq(paymentLinks.status, "created")));
}

export async function linkByGatewayId(tx: Tx, gatewayLinkId: string): Promise<PaymentLink | undefined> {
  const [l] = await tx.select().from(paymentLinks).where(eq(paymentLinks.gatewayLinkId, gatewayLinkId));
  return l;
}

// Live links older than `before`, oldest first: what the hourly check asks Razorpay about.
export async function staleLinks(tx: Tx, before: Date, limit = 200): Promise<PaymentLink[]> {
  return tx.select().from(paymentLinks).where(and(eq(paymentLinks.status, "created"), lt(paymentLinks.createdAt, before))).orderBy(asc(paymentLinks.createdAt)).limit(limit);
}

export type Contact = { name: string; phone: string | null };

// Who a link is for: the invoice's payer, else the lead guardian of a member paying for themselves, else the member.
export async function familyContact(tx: Tx, inv: Pick<Invoice, "payerGuardianId" | "payerMemberId">): Promise<Contact> {
  const contacts = await payerContacts(tx, inv);
  const g = contacts.find((x) => x.isPrimary) ?? contacts[0];
  if (g) return { name: g.fullName, phone: g.phone };
  const [m] = inv.payerMemberId ? await tx.select({ name: students.fullName, phone: students.phone }).from(students).where(eq(students.id, inv.payerMemberId)) : [];
  return m ?? { name: "", phone: null };
}

export async function paymentByGatewayId(tx: Tx, gatewayPaymentId: string): Promise<Payment | undefined> {
  const [p] = await tx.select().from(payments).where(eq(payments.gatewayPaymentId, gatewayPaymentId));
  return p;
}

export async function refundByGatewayId(tx: Tx, gatewayRefundId: string): Promise<Refund | undefined> {
  const [r] = await tx.select().from(refunds).where(eq(refunds.gatewayRefundId, gatewayRefundId));
  return r;
}

export async function linkById(tx: Tx, id: string): Promise<PaymentLink | undefined> {
  const [l] = await tx.select().from(paymentLinks).where(eq(paymentLinks.id, id));
  return l;
}

// The payers a collect screen for these members can show: each member paying for themselves, and every guardian ever linked to one.
// Removed links are included on purpose: a payer whose child left still owes and still pays.
export async function payersOfMembers(tx: Tx, memberIds: string[]): Promise<Payer[]> {
  const guardianPayers = (await guardiansOfMembers(tx, memberIds, { includeRemoved: true })).map((g): Payer => ({ kind: "guardian", guardianId: g.id }));
  return [...guardianPayers, ...memberIds.map((memberId): Payer => ({ kind: "member", memberId }))];
}

// Whether this payer is one a collect screen for these members offers.
export async function payerInScope(tx: Tx, memberIds: string[], payer: Payer): Promise<boolean> {
  const key = payerKey(payer);
  return (await payersOfMembers(tx, memberIds)).some((p) => payerKey(p) === key);
}

// The member and the members who share a guardian with them (siblings), deleted ones too: their invoices are still owed. Removed links and deleted guardians share nothing.
export async function memberIdsWithSiblings(tx: Tx, memberId: string): Promise<string[]> {
  const live = and(isNull(studentGuardians.removedAt), isNull(guardians.deletedAt));
  const mine = tx.select({ id: studentGuardians.guardianId }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(and(eq(studentGuardians.studentId, memberId), live));
  const shared = tx.select({ id: studentGuardians.studentId }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(and(inArray(studentGuardians.guardianId, mine), live));
  const rows = await tx.select({ id: students.id }).from(students).where(or(eq(students.id, memberId), inArray(students.id, shared))).orderBy(asc(students.createdAt), asc(students.id));
  return rows.map((r) => r.id);
}

// A member's name and household (written on the payment until Task 9 drops the column), deleted ones too.
export async function memberHeader(tx: Tx, id: string): Promise<{ name: string; householdId: string } | undefined> {
  const [row] = await tx.select({ name: students.fullName, householdId: students.householdId }).from(students).where(eq(students.id, id));
  return row;
}
