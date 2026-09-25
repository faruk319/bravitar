import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, type SQL, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import type { Paise } from "@/lib/money/paise";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { staffUsers } from "@/modules/staff/schema";
import { guardians, households } from "@/modules/students/schema";
import { type AllocationKind, type LinkStatus, type Payment, type PaymentLink, paymentAllocations, paymentLinks, payments, type Refund, refunds } from "./schema";

// Every money move for a family takes turns: recording, cancelling, refunding,
// using the advance and releasing a voided invoice. The two-key form never
// collides with the single-key invoicing lock, which is always taken first.
export async function lockFamily(tx: Tx, householdId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('money'), hashtext(${householdId}))`);
}

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

// The family's issued and part-paid invoices in one branch, oldest first: due
// date, then number (length first, so 10000 sorts after 9999).
export async function openInvoices(tx: Tx, householdId: string, branchId: string): Promise<Invoice[]> {
  return tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.householdId, householdId), eq(invoices.branchId, branchId), inArray(invoices.status, ["issued", "part_paid"])))
    .orderBy(asc(invoices.dueDate), asc(sql`length(${invoices.number})`), asc(invoices.number), asc(invoices.id));
}

const allocatedTo = sql<string>`(SELECT coalesce(sum(a.amount_paise), 0) FROM app.payment_allocations a WHERE a.payment_id = ${payments.id})`;
const refundedFrom = sql<string>`(SELECT coalesce(sum(r.amount_paise), 0) FROM app.refunds r WHERE r.payment_id = ${payments.id})`;

// Confirmed payments of the family in a branch with money not yet on an
// invoice or refunded: the family's advance, oldest payment first.
export async function unusedPayments(tx: Tx, householdId: string, branchId: string): Promise<{ paymentId: string; unused: Paise }[]> {
  const rows = await tx
    .select({ paymentId: payments.id, unused: sql<string>`(${payments.amountPaise} - ${allocatedTo} - ${refundedFrom})::text` })
    .from(payments)
    .where(and(eq(payments.householdId, householdId), eq(payments.branchId, branchId), eq(payments.status, "confirmed")))
    .orderBy(asc(payments.recordedOn), asc(payments.createdAt), asc(payments.id));
  return rows.map((r) => ({ paymentId: r.paymentId, unused: BigInt(r.unused) })).filter((r) => r.unused > 0n);
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

export async function receiptNames(tx: Tx, p: Payment): Promise<{ householdName: string; collectorName: string | null }> {
  const [h] = await tx.select({ name: households.name }).from(households).where(eq(households.id, p.householdId));
  const [s] = p.receivedBy ? await tx.select({ name: staffUsers.fullName }).from(staffUsers).where(eq(staffUsers.id, p.receivedBy)) : [];
  return { householdName: h?.name ?? "", collectorName: s?.name ?? null };
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
      householdName: households.name,
      collectorName: staffUsers.fullName,
    })
    .from(payments)
    .innerJoin(households, eq(households.id, payments.householdId))
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
      householdName: households.name,
    })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .innerJoin(households, eq(households.id, payments.householdId))
    .where(and(eq(payments.branchId, branchId), eq(refunds.refundedOn, day)))
    .orderBy(asc(refunds.refundedAt), asc(refunds.id));
}

// Money taken in on a day across branches (empty = all): what the dashboard shows.
export async function collectedOn(tx: Tx, branchIds: string[], day: string): Promise<{ count: number; total: Paise }> {
  const [r] = await tx
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text` })
    .from(payments)
    .where(and(eq(payments.recordedOn, day), inArray(payments.status, ["confirmed", "refunded"]), paymentScope(branchIds)));
  return { count: r?.count ?? 0, total: BigInt(r?.total ?? "0") };
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

// Who a link is for: the family's primary guardian, else the family itself.
export async function familyContact(tx: Tx, householdId: string): Promise<Contact> {
  const [g] = await tx
    .select({ name: guardians.fullName, phone: guardians.phone })
    .from(guardians)
    .where(and(eq(guardians.householdId, householdId), isNull(guardians.deletedAt)))
    .orderBy(desc(guardians.isPrimary), asc(guardians.createdAt))
    .limit(1);
  if (g) return g;
  const [h] = await tx.select({ name: households.name }).from(households).where(eq(households.id, householdId));
  return { name: h?.name ?? "", phone: null };
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
