import { and, asc, eq, gte, inArray, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { batches, programs } from "@/modules/batches/schema";
import { enrollments } from "@/modules/enrollments/schema";
import { type Session, sessions } from "@/modules/sessions/schema";
import { students } from "@/modules/students/schema";
import { resources } from "@/modules/tenancy/schema";
import { type AttendanceRow, attendance, type Mark } from "./schema";

export type ClassRow = { session: Session; batchName: string; programName: string; roomName: string | null; batchCoachId: string | null };
export type ClassScope = { branchIds: string[]; coachId?: string };

// A substitute (sessions.coach_id) takes the class; otherwise the batch's coach.
function inScope(scope: ClassScope): SQL | undefined {
  return and(
    scope.branchIds.length ? inArray(sessions.branchId, scope.branchIds) : undefined,
    scope.coachId ? or(eq(sessions.coachId, scope.coachId), and(isNull(sessions.coachId), eq(batches.coachId, scope.coachId))) : undefined,
  );
}

async function classRows(tx: Tx, where: SQL | undefined): Promise<ClassRow[]> {
  const rows = await tx
    .select({ session: sessions, batchName: batches.name, programName: programs.name, roomName: resources.name, batchCoachId: batches.coachId })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .leftJoin(resources, eq(resources.id, sql`coalesce(${sessions.resourceId}, ${batches.resourceId})`))
    .where(where)
    .orderBy(asc(sessions.startsAt));
  return rows;
}

export async function classesOn(tx: Tx, date: string, scope: ClassScope): Promise<ClassRow[]> {
  return classRows(tx, and(eq(sessions.sessionDate, date), isNull(batches.deletedAt), inScope(scope)));
}

export async function getClass(tx: Tx, id: string, scope: ClassScope): Promise<ClassRow | undefined> {
  const [row] = await classRows(tx, and(eq(sessions.id, id), inScope(scope)));
  return row;
}

export async function marksFor(tx: Tx, sessionIds: string[]): Promise<AttendanceRow[]> {
  if (!sessionIds.length) return [];
  return tx.select().from(attendance).where(inArray(attendance.sessionId, sessionIds));
}

export type NewMark = { tenantId: string; sessionId: string; studentId: string; status: Mark; note: string | null; markedBy: string; markedAt: Date };

// (session_id, student_id) is the idempotency key: a second device updates, never duplicates.
export async function upsertMarks(tx: Tx, rows: NewMark[]): Promise<void> {
  if (!rows.length) return;
  await tx
    .insert(attendance)
    .values(rows.map((r) => ({ id: uuidv7(), ...r })))
    .onConflictDoUpdate({
      target: [attendance.sessionId, attendance.studentId],
      set: { status: sql`excluded.status`, note: sql`excluded.note`, markedBy: sql`excluded.marked_by`, markedAt: sql`excluded.marked_at` },
    });
}

export async function markSessionHeld(tx: Tx, sessionId: string): Promise<void> {
  await tx.update(sessions).set({ status: "held" }).where(and(eq(sessions.id, sessionId), eq(sessions.status, "scheduled")));
}

// A batch's classes in [from, to], oldest first.
export async function batchClasses(tx: Tx, batchId: string, from: string, to: string): Promise<Session[]> {
  return tx
    .select()
    .from(sessions)
    .where(and(eq(sessions.batchId, batchId), gte(sessions.sessionDate, from), lte(sessions.sessionDate, to)))
    .orderBy(asc(sessions.startsAt));
}

// Students enrolled at any point in [from, to] (empty ranges excluded).
export async function enrolledBetween(tx: Tx, batchId: string, from: string, to: string): Promise<{ id: string; name: string; code: string }[]> {
  return tx
    .selectDistinct({ id: students.id, name: students.fullName, code: students.code })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(
      and(
        eq(enrollments.batchId, batchId),
        sql`${enrollments.startDate} <= ${to}::date`,
        sql`(${enrollments.endDate} IS NULL OR ${enrollments.endDate} >= GREATEST(${enrollments.startDate}, ${from}::date))`,
        isNull(students.deletedAt),
      ),
    )
    .orderBy(asc(students.fullName));
}

export type StudentClass = { sessionId: string; date: string; startsAt: Date; batchName: string; mark: Mark | null };

// Started, not cancelled classes in [from, to] the student was due at (enrolled,
// not paused), plus any class they were marked for.
export async function studentClasses(tx: Tx, studentId: string, from: string, to: string, now: Date): Promise<StudentClass[]> {
  const rows = await tx
    .select({ sessionId: sessions.id, date: sessions.sessionDate, startsAt: sessions.startsAt, batchName: batches.name, mark: attendance.status })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batchId))
    .leftJoin(attendance, and(eq(attendance.sessionId, sessions.id), eq(attendance.studentId, studentId)))
    .where(
      and(
        gte(sessions.sessionDate, from),
        lte(sessions.sessionDate, to),
        ne(sessions.status, "cancelled"),
        lte(sessions.startsAt, now),
        or(
          sql`${attendance.id} IS NOT NULL`,
          sql`EXISTS (SELECT 1 FROM ${enrollments} WHERE ${enrollments.batchId} = ${sessions.batchId} AND ${enrollments.studentId} = ${studentId}
                AND ${enrollments.startDate} <= ${sessions.sessionDate} AND (${enrollments.endDate} IS NULL OR ${enrollments.endDate} >= ${sessions.sessionDate})
                AND NOT (${enrollments.status} = 'paused' AND ${enrollments.pausedOn} <= ${sessions.sessionDate}))`,
        ),
      ),
    )
    .orderBy(asc(sessions.startsAt));
  return rows;
}

export async function studentNames(tx: Tx, ids: string[]): Promise<Map<string, { name: string; code: string }>> {
  if (!ids.length) return new Map();
  const rows = await tx.select({ id: students.id, name: students.fullName, code: students.code }).from(students).where(inArray(students.id, ids));
  return new Map(rows.map((r) => [r.id, { name: r.name, code: r.code }]));
}
