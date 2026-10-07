import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { batches } from "@/modules/batches/schema";
import { type Payment, payments } from "@/modules/payments/schema";
import { sessions } from "@/modules/sessions/schema";
import { guardians, type Student, studentGuardians, students } from "@/modules/students/schema";

export type PortalChild = Pick<Student, "id" | "fullName" | "code" | "status"> & { isManager: boolean };

// The students linked to this guardian, while the guardian may sign in.
export async function linkedChildren(tx: Tx, guardianId: string): Promise<PortalChild[]> {
  return tx
    .select({ id: students.id, fullName: students.fullName, code: students.code, status: students.status, isManager: studentGuardians.isManager })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .innerJoin(students, eq(students.id, studentGuardians.studentId))
    .where(and(eq(studentGuardians.guardianId, guardianId), isNull(studentGuardians.removedAt), eq(guardians.canLogin, true), isNull(guardians.deletedAt), isNull(students.deletedAt)))
    .orderBy(asc(students.fullName));
}

// Whose money records this guardian may see: their own, and those of anyone
// linked to the same members (the family), or of a member they are linked to
// who pays for themselves. A guardian with no members still has their own.
export type Payers = { guardianIds: string[]; memberIds: string[] };

export async function payersOf(tx: Tx, guardianId: string): Promise<Payers> {
  const mine = await tx.select({ id: studentGuardians.studentId }).from(studentGuardians).where(and(eq(studentGuardians.guardianId, guardianId), isNull(studentGuardians.removedAt)));
  const memberIds = mine.map((m) => m.id);
  const family = memberIds.length
    ? await tx
        .selectDistinct({ id: studentGuardians.guardianId })
        .from(studentGuardians)
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .where(and(inArray(studentGuardians.studentId, memberIds), isNull(studentGuardians.removedAt), isNull(guardians.deletedAt)))
    : [];
  return { guardianIds: [...new Set([guardianId, ...family.map((f) => f.id)])], memberIds };
}

const paidBy = (p: Payers): SQL | undefined => or(inArray(payments.payerGuardianId, p.guardianIds), p.memberIds.length ? inArray(payments.payerMemberId, p.memberIds) : undefined);
export const invoiceBilledTo = (p: Payers): SQL | undefined => or(inArray(invoices.payerGuardianId, p.guardianIds), p.memberIds.length ? inArray(invoices.payerMemberId, p.memberIds) : undefined);

export type FamilyPayment = Pick<Payment, "id" | "receiptNumber" | "receivedOn" | "amountPaise" | "method" | "status">;

// Receipts of these payers, newest first; cancelled ones aren't receipts.
export async function familyPayments(tx: Tx, p: Payers): Promise<FamilyPayment[]> {
  return tx
    .select({ id: payments.id, receiptNumber: payments.receiptNumber, receivedOn: payments.receivedOn, amountPaise: payments.amountPaise, method: payments.method, status: payments.status })
    .from(payments)
    .where(and(paidBy(p), inArray(payments.status, ["confirmed", "refunded"])))
    .orderBy(desc(payments.receivedOn), desc(payments.receiptNumber));
}

export const isPaidBy = (p: Payers, pay: Pick<Payment, "payerGuardianId" | "payerMemberId">): boolean =>
  (pay.payerGuardianId !== null && p.guardianIds.includes(pay.payerGuardianId)) || (pay.payerMemberId !== null && p.memberIds.includes(pay.payerMemberId));

export const isBilledTo = (p: Payers, inv: Pick<Invoice, "payerGuardianId" | "payerMemberId">): boolean =>
  (inv.payerGuardianId !== null && p.guardianIds.includes(inv.payerGuardianId)) || (inv.payerMemberId !== null && p.memberIds.includes(inv.payerMemberId));

// Issued invoices billed to these payers, newest first, void and draft excluded: the history a guardian keeps even with no members.
export async function billedInvoices(tx: Tx, p: Payers): Promise<Invoice[]> {
  return tx
    .select()
    .from(invoices)
    .where(and(invoiceBilledTo(p), inArray(invoices.status, ["issued", "part_paid", "paid"])))
    .orderBy(desc(invoices.dueDate), desc(invoices.id));
}

export async function batchBranches(tx: Tx, batchIds: string[]): Promise<string[]> {
  if (!batchIds.length) return [];
  return (await tx.selectDistinct({ id: batches.branchId }).from(batches).where(inArray(batches.id, batchIds))).map((r) => r.id);
}

export async function cancelledClasses(tx: Tx, batchIds: string[], from: string, to: string): Promise<{ date: string; batchName: string; reason: string | null }[]> {
  if (!batchIds.length) return [];
  return tx
    .select({ date: sessions.sessionDate, batchName: batches.name, reason: sessions.cancelReason })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batchId))
    .where(and(inArray(sessions.batchId, batchIds), eq(sessions.status, "cancelled"), gte(sessions.sessionDate, from), lte(sessions.sessionDate, to)))
    .orderBy(asc(sessions.sessionDate));
}
