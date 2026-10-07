import { alias } from "drizzle-orm/pg-core";
import { and, asc, count, countDistinct, desc, eq, gte, ilike, inArray, isNull, like, lte, ne, or, type SQL, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { enrollments } from "@/modules/enrollments/schema";
import { type Payer, payerKey, payerOf } from "./payer";
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

export async function studentsOfHousehold(tx: Tx, householdId: string): Promise<Student[]> {
  return tx.select().from(students).where(and(eq(students.householdId, householdId), isNull(students.deletedAt))).orderBy(asc(students.fullName));
}

// Siblings are members who share a guardian: through live links, either side, no deleted guardian or member, never the member.
export async function siblingsOf(tx: Tx, studentId: string): Promise<Student[]> {
  const mine = alias(studentGuardians, "mine");
  const shared = tx
    .select({ guardianId: mine.guardianId })
    .from(mine)
    .innerJoin(guardians, eq(guardians.id, mine.guardianId))
    .where(and(eq(mine.studentId, studentId), isNull(mine.removedAt), isNull(guardians.deletedAt)));
  const siblingIds = tx
    .select({ id: studentGuardians.studentId })
    .from(studentGuardians)
    .where(and(inArray(studentGuardians.guardianId, shared), isNull(studentGuardians.removedAt)));
  return tx
    .select()
    .from(students)
    .where(and(inArray(students.id, siblingIds), ne(students.id, studentId), isNull(students.deletedAt)))
    .orderBy(asc(students.fullName), asc(students.id));
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

// A student's first family link: that person manages them (migration 0037).
export async function linkGuardian(tx: Tx, tenantId: string, studentId: string, guardianId: string, relation: Relation): Promise<void> {
  await tx.insert(studentGuardians).values({ tenantId, studentId, guardianId, relation, isManager: true }).onConflictDoNothing();
}

export type FamilyMember = Guardian & { relation: Relation; isManager: boolean };

// The people with access to any of these members, once each, a manager first;
// removed links (unless asked for) and deleted guardians aren't (student_guardians is the only link we read).
// includeRemoved is only for "is this number already known to this family": never for access checks, it resurfaces ended access.
export async function guardiansOfMembers(tx: Tx, studentIds: string[], opts: { includeRemoved?: boolean } = {}): Promise<FamilyMember[]> {
  if (!studentIds.length) return [];
  const rows = await tx
    .select({ g: guardians, relation: studentGuardians.relation, isManager: studentGuardians.isManager })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(and(inArray(studentGuardians.studentId, studentIds), opts.includeRemoved ? undefined : isNull(studentGuardians.removedAt), isNull(guardians.deletedAt)))
    .orderBy(desc(studentGuardians.isManager), asc(guardians.createdAt), asc(guardians.id));
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.g.id) && seen.add(r.g.id)).map((r) => ({ ...r.g, relation: r.relation, isManager: r.isManager }));
}

// Each member's lead guardian (manager first, then the earliest linked), one query for all; members with no live guardian are absent.
export async function leadGuardians(tx: Tx, studentIds: string[]): Promise<Map<string, string>> {
  if (!studentIds.length) return new Map();
  const rows = await tx
    .select({ studentId: studentGuardians.studentId, guardianId: guardians.id })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(and(inArray(studentGuardians.studentId, studentIds), isNull(studentGuardians.removedAt), isNull(guardians.deletedAt)))
    .orderBy(desc(studentGuardians.isManager), asc(guardians.createdAt), asc(guardians.id));
  const lead = new Map<string, string>();
  for (const r of rows) if (!lead.has(r.studentId)) lead.set(r.studentId, r.guardianId);
  return lead;
}

export const guardiansOfStudent = (tx: Tx, studentId: string): Promise<FamilyMember[]> => guardiansOfMembers(tx, [studentId]);

// The people to message for a payer: the guardian, or a member paying for themselves through their own links.
export async function payerContacts(tx: Tx, row: { payerGuardianId: string | null; payerMemberId: string | null }): Promise<Guardian[]> {
  const payer = payerOf(row);
  if (!payer) return [];
  if (payer.kind === "member") return guardiansOfStudent(tx, payer.memberId);
  return tx.select().from(guardians).where(and(eq(guardians.id, payer.guardianId), isNull(guardians.deletedAt)));
}

// Still used by the household lookups until the household goes (migration 0040).
export async function guardiansOfHouseholdMembers(tx: Tx, householdId: string, opts: { includeRemoved?: boolean } = {}): Promise<FamilyMember[]> {
  return guardiansOfMembers(tx, (await studentsOfHousehold(tx, householdId)).map((s) => s.id), opts);
}

// The members this guardian is linked to, by name; removed links and deleted members aren't.
export async function studentsOfGuardian(tx: Tx, guardianId: string): Promise<Student[]> {
  const rows = await tx
    .select({ s: students })
    .from(studentGuardians)
    .innerJoin(students, eq(students.id, studentGuardians.studentId))
    .where(and(eq(studentGuardians.guardianId, guardianId), isNull(studentGuardians.removedAt), isNull(students.deletedAt)))
    .orderBy(asc(students.fullName), asc(students.id));
  return rows.map((r) => r.s);
}

export type GuardianLink = { studentId: string; fullName: string; relation: Relation; branchId: string };

// Who this guardian is linked to now, with how they relate; removed links and deleted members aren't.
export async function linksOfGuardian(tx: Tx, guardianId: string): Promise<GuardianLink[]> {
  return tx
    .select({ studentId: students.id, fullName: students.fullName, relation: studentGuardians.relation, branchId: students.branchId })
    .from(studentGuardians)
    .innerJoin(students, eq(students.id, studentGuardians.studentId))
    .where(and(eq(studentGuardians.guardianId, guardianId), isNull(studentGuardians.removedAt), isNull(students.deletedAt)))
    .orderBy(asc(students.fullName), asc(students.id));
}

// Someone in the family gets access to this student, or gets it back.
export async function upsertFamilyLink(tx: Tx, link: { tenantId: string; studentId: string; guardianId: string; relation: Relation }): Promise<void> {
  await tx
    .insert(studentGuardians)
    .values(link)
    .onConflictDoUpdate({ target: [studentGuardians.studentId, studentGuardians.guardianId], set: { relation: link.relation, removedAt: null } });
}

// Clear, then set: one manager per student.
export async function moveManager(tx: Tx, studentId: string, guardianId: string): Promise<void> {
  await tx.update(studentGuardians).set({ isManager: false }).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.isManager, true)));
  await tx
    .update(studentGuardians)
    .set({ isManager: true })
    .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId), isNull(studentGuardians.removedAt)));
}

export async function removeFamilyLink(tx: Tx, studentId: string, guardianId: string, at: Date): Promise<void> {
  await tx.update(studentGuardians).set({ removedAt: at }).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId)));
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
    .leftJoin(studentGuardians, and(eq(studentGuardians.studentId, students.id), isNull(studentGuardians.removedAt)))
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
    .leftJoin(studentGuardians, and(eq(studentGuardians.studentId, students.id), isNull(studentGuardians.removedAt)))
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

// Waiting for a batch: on the roll, but in nothing yet.
export async function countWithoutBatch(tx: Tx, scope: Scope): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(students)
    .where(
      and(
        eq(students.status, "active"),
        isNull(students.deletedAt),
        inScope(scope),
        sql`NOT EXISTS (SELECT 1 FROM ${enrollments} WHERE ${enrollments.studentId} = ${students.id} AND ${enrollments.status} = 'active')`,
      ),
    );
  return r?.n ?? 0;
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

// Active members each payer answers for, for the at-risk list: a guardian's live links, or the member paying for themselves.
export async function activeStudentsOf(tx: Tx, scope: Scope, payers: Payer[]): Promise<{ payerKey: string; student: Pick<Student, "id" | "fullName" | "code"> }[]> {
  const gIds = payers.flatMap((p) => (p.kind === "guardian" ? [p.guardianId] : []));
  const mIds = payers.flatMap((p) => (p.kind === "member" ? [p.memberId] : []));
  const live = and(eq(students.status, "active"), isNull(students.deletedAt), inScope(scope));
  const cols = { id: students.id, fullName: students.fullName, code: students.code };
  const [linked, own] = await Promise.all([
    gIds.length
      ? tx.select({ ...cols, guardianId: studentGuardians.guardianId }).from(studentGuardians).innerJoin(students, eq(students.id, studentGuardians.studentId)).where(and(inArray(studentGuardians.guardianId, gIds), isNull(studentGuardians.removedAt), live))
      : [],
    mIds.length ? tx.select(cols).from(students).where(and(inArray(students.id, mIds), live)) : [],
  ]);
  return [
    ...linked.map((r) => ({ payerKey: payerKey({ kind: "guardian", guardianId: r.guardianId }), student: { id: r.id, fullName: r.fullName, code: r.code } })),
    ...own.map((r) => ({ payerKey: payerKey({ kind: "member", memberId: r.id }), student: r })),
  ];
}
