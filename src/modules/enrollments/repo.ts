import { and, asc, eq, gt, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { batches, programs } from "@/modules/batches/schema";
import { students } from "@/modules/students/schema";
import { type Enrollment, enrollments } from "./schema";

// Still on the batch's list on or after `day`; an empty range never is.
const reaches = (day: string): SQL => sql`(${enrollments.endDate} IS NULL OR ${enrollments.endDate} >= GREATEST(${enrollments.startDate}, ${day}::date))`;

export async function insertEnrollment(tx: Tx, row: Pick<Enrollment, "tenantId" | "studentId" | "batchId" | "startDate">): Promise<Enrollment> {
  const [e] = await tx.insert(enrollments).values({ id: uuidv7(), ...row }).returning();
  if (!e) throw new Error("enrollment insert returned no row");
  return e;
}

export async function getEnrollment(tx: Tx, id: string): Promise<Enrollment | undefined> {
  const [e] = await tx.select().from(enrollments).where(eq(enrollments.id, id));
  return e;
}

export async function updateEnrollment(tx: Tx, id: string, patch: Partial<typeof enrollments.$inferInsert>): Promise<Enrollment> {
  const [e] = await tx.update(enrollments).set(patch).where(eq(enrollments.id, id)).returning();
  if (!e) throw new Error("enrollment update returned no row");
  return e;
}

export async function findOverlap(tx: Tx, studentId: string, batchId: string, from: string): Promise<Enrollment | undefined> {
  const [e] = await tx
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.batchId, batchId), reaches(from)))
    .limit(1);
  return e;
}

export async function hasEnrollments(tx: Tx, by: { studentId: string } | { batchId: string }): Promise<boolean> {
  const where = "studentId" in by ? eq(enrollments.studentId, by.studentId) : eq(enrollments.batchId, by.batchId);
  const [e] = await tx.select({ id: enrollments.id }).from(enrollments).where(where).limit(1);
  return Boolean(e);
}

export type RosterRow = Enrollment & { studentName: string; studentCode: string };

export async function rosterOf(tx: Tx, batchId: string, from: string): Promise<RosterRow[]> {
  const rows = await tx
    .select({ e: enrollments, studentName: students.fullName, studentCode: students.code })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(eq(enrollments.batchId, batchId), reaches(from), isNull(students.deletedAt)))
    .orderBy(asc(students.fullName));
  return rows.map((r) => ({ ...r.e, studentName: r.studentName, studentCode: r.studentCode }));
}

// Student id -> batches they're in or joining on `day` (list views).
export async function currentBatchNames(tx: Tx, studentIds: string[], day: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!studentIds.length) return out;
  const rows = await tx
    .select({ studentId: enrollments.studentId, name: batches.name })
    .from(enrollments)
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .where(and(inArray(enrollments.studentId, studentIds), reaches(day)))
    .orderBy(asc(batches.name));
  for (const r of rows) out.set(r.studentId, [...(out.get(r.studentId) ?? []), r.name]);
  return out;
}

// Batch id -> students on the roster on `day` (paused included).
export async function rosterCounts(tx: Tx, batchIds: string[], day: string): Promise<Map<string, number>> {
  if (!batchIds.length) return new Map();
  const rows = await tx
    .select({ batchId: enrollments.batchId, n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(inArray(enrollments.batchId, batchIds), reaches(day), sql`${enrollments.startDate} <= ${day}::date`))
    .groupBy(enrollments.batchId);
  return new Map(rows.map((r) => [r.batchId, r.n]));
}

export type StudentEnrollment = Enrollment & { batchName: string; programName: string; nextBatchName: string | null };

export async function enrollmentsOfStudent(tx: Tx, studentId: string): Promise<StudentEnrollment[]> {
  const next = alias(enrollments, "next");
  const nextBatch = alias(batches, "next_batch");
  const rows = await tx
    .select({ e: enrollments, batchName: batches.name, programName: programs.name, nextBatchName: nextBatch.name })
    .from(enrollments)
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .leftJoin(next, eq(next.id, enrollments.transferredToEnrollmentId))
    .leftJoin(nextBatch, eq(nextBatch.id, next.batchId))
    .where(eq(enrollments.studentId, studentId))
    .orderBy(asc(enrollments.startDate), asc(enrollments.createdAt));
  return rows.map((r) => ({ ...r.e, batchName: r.batchName, programName: r.programName, nextBatchName: r.nextBatchName }));
}

// A student's own status carries to their batches (agreed 2026-09-23).
// Each returns the ids it changed.
export async function endForStudent(tx: Tx, studentId: string, lastDay: string): Promise<string[]> {
  const rows = await tx
    .update(enrollments)
    .set({
      status: sql`CASE WHEN ${enrollments.status} IN ('active', 'paused') THEN 'left' ELSE ${enrollments.status} END`,
      pausedOn: null,
      endDate: sql`GREATEST(${enrollments.startDate} - 1, ${lastDay}::date)`,
    })
    .where(and(eq(enrollments.studentId, studentId), or(isNull(enrollments.endDate), gt(enrollments.endDate, lastDay))))
    .returning({ id: enrollments.id });
  return rows.map((r) => r.id);
}

export async function pauseForStudent(tx: Tx, studentId: string, today: string): Promise<string[]> {
  const rows = await tx
    .update(enrollments)
    .set({ status: "paused", pausedOn: today })
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, "active")))
    .returning({ id: enrollments.id });
  return rows.map((r) => r.id);
}

export async function resumeForStudent(tx: Tx, studentId: string): Promise<string[]> {
  const rows = await tx
    .update(enrollments)
    .set({ status: "active", pausedOn: null })
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, "paused")))
    .returning({ id: enrollments.id });
  return rows.map((r) => r.id);
}
