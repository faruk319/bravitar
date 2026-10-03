import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
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

export type FamilyPayment = Pick<Payment, "id" | "receiptNumber" | "receivedOn" | "amountPaise" | "method" | "status">;

// A family's receipts, newest first; cancelled ones aren't receipts.
export async function familyPayments(tx: Tx, householdId: string): Promise<FamilyPayment[]> {
  return tx
    .select({ id: payments.id, receiptNumber: payments.receiptNumber, receivedOn: payments.receivedOn, amountPaise: payments.amountPaise, method: payments.method, status: payments.status })
    .from(payments)
    .where(and(eq(payments.householdId, householdId), inArray(payments.status, ["confirmed", "refunded"])))
    .orderBy(desc(payments.receivedOn), desc(payments.receiptNumber));
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
