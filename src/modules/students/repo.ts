import { and, asc, count, countDistinct, desc, eq, gte, ilike, inArray, isNull, like, lte, or, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { type Consent, type ConsentKind, consents, type Guardian, guardians, type Household, households, type Relation, type Student, type StudentStatus, studentGuardians, students } from "./schema";

// Branch scoping is an explicit filter (docs/01): `branchIds` empty = all.
export type Scope = { branchIds: string[] };

function inScope(scope: Scope): SQL | undefined {
  return scope.branchIds.length ? inArray(students.branchId, scope.branchIds) : undefined;
}

export async function createHousehold(tx: Tx, input: { tenantId: string; name: string; address?: string }): Promise<Household> {
  const [row] = await tx.insert(households).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("household insert returned no row");
  return row;
}

export async function getHousehold(tx: Tx, id: string): Promise<Household | undefined> {
  const [row] = await tx.select().from(households).where(and(eq(households.id, id), isNull(households.deletedAt)));
  return row;
}

export async function createGuardian(tx: Tx, input: { tenantId: string; householdId: string; fullName: string; phone: string; email?: string; isPrimary?: boolean }): Promise<Guardian> {
  const [row] = await tx.insert(guardians).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("guardian insert returned no row");
  return row;
}

export async function findGuardianByPhone(tx: Tx, phone: string): Promise<Guardian | undefined> {
  const [row] = await tx.select().from(guardians).where(and(eq(guardians.phone, phone), isNull(guardians.deletedAt)));
  return row;
}

export async function getGuardian(tx: Tx, id: string): Promise<Guardian | undefined> {
  const [g] = await tx.select().from(guardians).where(and(eq(guardians.id, id), isNull(guardians.deletedAt)));
  return g;
}

export async function updateGuardian(tx: Tx, id: string, patch: Partial<typeof guardians.$inferInsert>): Promise<Guardian> {
  const [g] = await tx.update(guardians).set(patch).where(eq(guardians.id, id)).returning();
  if (!g) throw new Error("guardian update matched no row");
  return g;
}

export async function guardiansOfHousehold(tx: Tx, householdId: string): Promise<Guardian[]> {
  return tx.select().from(guardians).where(and(eq(guardians.householdId, householdId), isNull(guardians.deletedAt))).orderBy(asc(guardians.isPrimary), asc(guardians.fullName));
}

export async function studentsOfHousehold(tx: Tx, householdId: string): Promise<Student[]> {
  return tx.select().from(students).where(and(eq(students.householdId, householdId), isNull(students.deletedAt))).orderBy(asc(students.fullName));
}

export type NewStudentRow = Omit<typeof students.$inferInsert, "id">;

export async function insertStudent(tx: Tx, row: NewStudentRow): Promise<Student> {
  const [s] = await tx.insert(students).values({ id: uuidv7(), ...row }).returning();
  if (!s) throw new Error("student insert returned no row");
  return s;
}

export async function getStudent(tx: Tx, scope: Scope, id: string): Promise<Student | undefined> {
  const [row] = await tx.select().from(students).where(and(eq(students.id, id), isNull(students.deletedAt), inScope(scope)));
  return row;
}

export async function updateStudent(tx: Tx, id: string, patch: Partial<typeof students.$inferInsert>): Promise<Student> {
  const [row] = await tx.update(students).set({ ...patch, updatedAt: new Date() }).where(eq(students.id, id)).returning();
  if (!row) throw new Error("student update matched no row");
  return row;
}

export async function linkGuardian(tx: Tx, tenantId: string, studentId: string, guardianId: string, relation: Relation): Promise<void> {
  await tx.insert(studentGuardians).values({ tenantId, studentId, guardianId, relation }).onConflictDoNothing();
}

export async function guardiansOfStudent(tx: Tx, studentId: string): Promise<(Guardian & { relation: Relation })[]> {
  const rows = await tx
    .select({ g: guardians, relation: studentGuardians.relation })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(and(eq(studentGuardians.studentId, studentId), isNull(guardians.deletedAt)));
  return rows.map((r) => ({ ...r.g, relation: r.relation }));
}

export type StudentListRow = { student: Student; guardianName: string | null; guardianPhone: string | null };
type ListFilter = { q?: string; status?: StudentStatus };

// Partial name (trigram-indexed) or phone digits, within scope, optional status.
function listWhere(scope: Scope, opts: ListFilter): SQL | undefined {
  const q = opts.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const where = [isNull(students.deletedAt), inScope(scope)];
  if (opts.status) where.push(eq(students.status, opts.status));
  if (q) {
    const byName = ilike(students.fullName, `%${q}%`);
    where.push(digits.length >= 4 ? or(byName, like(students.phone, `%${digits}%`), like(guardians.phone, `%${digits}%`)) : byName);
  }
  return and(...where);
}

export async function searchStudents(tx: Tx, scope: Scope, opts: ListFilter & { limit?: number; offset?: number }): Promise<StudentListRow[]> {
  return tx
    .selectDistinctOn([students.fullName, students.id], { student: students, guardianName: guardians.fullName, guardianPhone: guardians.phone })
    .from(students)
    .leftJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
    .leftJoin(guardians, and(eq(guardians.id, studentGuardians.guardianId), isNull(guardians.deletedAt)))
    .where(listWhere(scope, opts))
    .orderBy(asc(students.fullName), asc(students.id), desc(guardians.isPrimary))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function countStudents(tx: Tx, scope: Scope, opts: ListFilter = {}): Promise<number> {
  const [row] = await tx
    .select({ n: countDistinct(students.id) })
    .from(students)
    .leftJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
    .leftJoin(guardians, and(eq(guardians.id, studentGuardians.guardianId), isNull(guardians.deletedAt)))
    .where(listWhere(scope, opts));
  return row?.n ?? 0;
}

export async function countByStatus(tx: Tx, scope: Scope): Promise<Record<StudentStatus, number>> {
  const rows = await tx.select({ status: students.status, n: count() }).from(students).where(and(isNull(students.deletedAt), inScope(scope))).groupBy(students.status);
  const out: Record<StudentStatus, number> = { active: 0, paused: 0, left: 0, prospect: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function listConsents(tx: Tx, studentId: string): Promise<Consent[]> {
  return tx.select().from(consents).where(eq(consents.studentId, studentId)).orderBy(asc(consents.kind), asc(consents.grantedAt));
}

// Grant/revoke is a new row each time: consent history is evidence.
export async function recordConsent(tx: Tx, input: { tenantId: string; studentId: string; guardianId?: string | null; kind: ConsentKind; granted: boolean; grantedIp?: string; method: "portal" | "paper" | "staff_recorded" }): Promise<Consent> {
  const [row] = await tx
    .insert(consents)
    .values({ id: uuidv7(), ...input, guardianId: input.guardianId ?? null, grantedIp: input.grantedIp ?? null, revokedAt: input.granted ? null : new Date() })
    .returning();
  if (!row) throw new Error("consent insert returned no row");
  return row;
}

// Latest row per kind decides.
export async function currentConsents(tx: Tx, studentId: string): Promise<Partial<Record<ConsentKind, boolean>>> {
  const rows = await listConsents(tx, studentId);
  const out: Partial<Record<ConsentKind, boolean>> = {};
  for (const c of rows) out[c.kind] = c.granted;
  return out;
}

export async function countJoinedSince(tx: Tx, scope: Scope, from: string): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(students).where(and(isNull(students.deletedAt), inScope(scope), gte(students.joinedOn, from)));
  return row?.n ?? 0;
}

export type StudentMove = Pick<Student, "id" | "fullName" | "code" | "leftReason"> & { on: string };

// Admissions and dropouts: who joined, or left, between two dates.
export async function joinedBetween(tx: Tx, scope: Scope, from: string, to: string): Promise<StudentMove[]> {
  return tx
    .select({ id: students.id, fullName: students.fullName, code: students.code, leftReason: students.leftReason, on: students.joinedOn })
    .from(students)
    .where(and(isNull(students.deletedAt), inScope(scope), gte(students.joinedOn, from), lte(students.joinedOn, to)))
    .orderBy(asc(students.joinedOn), asc(students.fullName));
}

export async function leftBetween(tx: Tx, scope: Scope, from: string, to: string): Promise<StudentMove[]> {
  const rows = await tx
    .select({ id: students.id, fullName: students.fullName, code: students.code, leftReason: students.leftReason, on: students.leftOn })
    .from(students)
    .where(and(isNull(students.deletedAt), inScope(scope), gte(students.leftOn, from), lte(students.leftOn, to)))
    .orderBy(asc(students.leftOn), asc(students.fullName));
  return rows.map((r) => ({ ...r, on: r.on ?? "" }));
}

// Active students of these families, for the at-risk list.
export async function activeStudentsOf(tx: Tx, scope: Scope, householdIds: string[]): Promise<Pick<Student, "id" | "fullName" | "code" | "householdId">[]> {
  if (!householdIds.length) return [];
  return tx
    .select({ id: students.id, fullName: students.fullName, code: students.code, householdId: students.householdId })
    .from(students)
    .where(and(inArray(students.householdId, householdIds), eq(students.status, "active"), isNull(students.deletedAt), inScope(scope)))
    .orderBy(asc(students.fullName));
}
