import { and, asc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { staffBranches, staffUsers } from "@/modules/staff/schema";
import { branches, resources } from "@/modules/tenancy/schema";
import type { Rule, Slot } from "./schedule";
import { type Batch, batches, batchSchedules, type Holiday, holidays, type Program, programs } from "./schema";

// branchIds empty = all branches (docs/01 branch scoping: explicit filter).
const batchScope = (branchIds: string[]): SQL | undefined => (branchIds.length ? inArray(batches.branchId, branchIds) : undefined);

export async function createProgram(tx: Tx, input: { tenantId: string; name: string; activityKey: string; description?: string }): Promise<Program> {
  const [row] = await tx.insert(programs).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("program insert returned no row");
  return row;
}

export async function listPrograms(tx: Tx, opts: { activeOnly?: boolean } = {}): Promise<Program[]> {
  const where = opts.activeOnly ? and(isNull(programs.deletedAt), eq(programs.isActive, true)) : isNull(programs.deletedAt);
  return tx.select().from(programs).where(where).orderBy(asc(programs.name));
}

export async function getProgram(tx: Tx, id: string): Promise<Program | undefined> {
  const [row] = await tx.select().from(programs).where(and(eq(programs.id, id), isNull(programs.deletedAt)));
  return row;
}

export async function updateProgram(tx: Tx, id: string, patch: Partial<Pick<Program, "name" | "description" | "isActive">>): Promise<Program> {
  const [row] = await tx.update(programs).set(patch).where(eq(programs.id, id)).returning();
  if (!row) throw new Error("program update matched no row");
  return row;
}

export async function insertBatch(tx: Tx, input: Omit<typeof batches.$inferInsert, "id">): Promise<Batch> {
  const [row] = await tx.insert(batches).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("batch insert returned no row");
  return row;
}

export async function getBatch(tx: Tx, branchIds: string[], id: string): Promise<Batch | undefined> {
  const [row] = await tx.select().from(batches).where(and(eq(batches.id, id), isNull(batches.deletedAt), batchScope(branchIds)));
  return row;
}

export async function updateBatch(tx: Tx, id: string, patch: Partial<typeof batches.$inferInsert>): Promise<Batch> {
  const [row] = await tx.update(batches).set(patch).where(eq(batches.id, id)).returning();
  if (!row) throw new Error("batch update matched no row");
  return row;
}

export type BatchRow = Batch & { programName: string; branchName: string; coachName: string | null; resourceName: string | null };

export async function listBatchRows(tx: Tx, branchIds: string[], opts: { includeEnded?: boolean; branchId?: string; id?: string } = {}): Promise<BatchRow[]> {
  const where = [isNull(batches.deletedAt), batchScope(branchIds)];
  if (!opts.includeEnded) where.push(or(eq(batches.status, "active"), eq(batches.status, "paused")));
  if (opts.branchId) where.push(eq(batches.branchId, opts.branchId));
  if (opts.id) where.push(eq(batches.id, opts.id));
  const rows = await tx
    .select({ b: batches, programName: programs.name, branchName: branches.name, coachName: staffUsers.fullName, resourceName: resources.name })
    .from(batches)
    .innerJoin(programs, eq(programs.id, batches.programId))
    .innerJoin(branches, eq(branches.id, batches.branchId))
    .leftJoin(staffUsers, eq(staffUsers.id, batches.coachId))
    .leftJoin(resources, eq(resources.id, batches.resourceId))
    .where(and(...where))
    .orderBy(asc(programs.name), asc(batches.name));
  return rows.map((r) => ({ ...r.b, programName: r.programName, branchName: r.branchName, coachName: r.coachName, resourceName: r.resourceName }));
}

const asRule = (r: typeof batchSchedules.$inferSelect): Rule & { batchId: string } => ({
  batchId: r.batchId,
  weekday: r.weekday,
  startTime: r.startTime.slice(0, 5),
  endTime: r.endTime.slice(0, 5),
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
});

export async function rulesFor(tx: Tx, batchIds: string[]): Promise<(Rule & { batchId: string })[]> {
  if (!batchIds.length) return [];
  const rows = await tx.select().from(batchSchedules).where(inArray(batchSchedules.batchId, batchIds)).orderBy(asc(batchSchedules.effectiveFrom), asc(batchSchedules.weekday));
  return rows.map(asRule);
}

export async function insertRules(tx: Tx, tenantId: string, batchId: string, slots: Slot[], from: string): Promise<void> {
  await tx.insert(batchSchedules).values(slots.map((s) => ({ id: uuidv7(), tenantId, batchId, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, effectiveFrom: from })));
}

// Rules in force on `from` end the day before; rules not yet in force are
// dropped (they never applied). The past is never rewritten.
export async function closeRulesFrom(tx: Tx, batchId: string, from: string): Promise<void> {
  await tx.delete(batchSchedules).where(and(eq(batchSchedules.batchId, batchId), gte(batchSchedules.effectiveFrom, from)));
  await tx
    .update(batchSchedules)
    .set({ effectiveTo: sql`(${from}::date - 1)` })
    .where(and(eq(batchSchedules.batchId, batchId), lt(batchSchedules.effectiveFrom, from), or(isNull(batchSchedules.effectiveTo), gte(batchSchedules.effectiveTo, from))));
}

export async function deleteAllRules(tx: Tx, batchId: string): Promise<void> {
  await tx.delete(batchSchedules).where(eq(batchSchedules.batchId, batchId));
}

export type CoachOption = { id: string; fullName: string; branchIds: string[] };

// Active staff and the branches they work in (empty = all).
export async function coachOptions(tx: Tx): Promise<CoachOption[]> {
  const rows = await tx
    .select({ id: staffUsers.id, fullName: staffUsers.fullName, branchId: staffBranches.branchId })
    .from(staffUsers)
    .leftJoin(staffBranches, eq(staffBranches.staffId, staffUsers.id))
    .where(and(eq(staffUsers.isActive, true), isNull(staffUsers.deletedAt)))
    .orderBy(asc(staffUsers.fullName));
  const out = new Map<string, CoachOption>();
  for (const r of rows) {
    const c = out.get(r.id) ?? { id: r.id, fullName: r.fullName, branchIds: [] };
    if (r.branchId) c.branchIds.push(r.branchId);
    out.set(r.id, c);
  }
  return [...out.values()];
}

export async function createHoliday(tx: Tx, input: { tenantId: string; branchId: string | null; date: string; name: string }): Promise<Holiday> {
  const [row] = await tx.insert(holidays).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("holiday insert returned no row");
  return row;
}

export async function getHoliday(tx: Tx, id: string): Promise<Holiday | undefined> {
  const [row] = await tx.select().from(holidays).where(eq(holidays.id, id));
  return row;
}

export async function deleteHoliday(tx: Tx, id: string): Promise<void> {
  await tx.delete(holidays).where(eq(holidays.id, id));
}

// All-branch holidays plus those of the given branches (empty = every branch).
export async function listHolidays(tx: Tx, branchIds: string[], range: { from?: string; to?: string } = {}): Promise<Holiday[]> {
  const where = [branchIds.length ? or(isNull(holidays.branchId), inArray(holidays.branchId, branchIds)) : undefined];
  if (range.from) where.push(gte(holidays.date, range.from));
  if (range.to) where.push(sql`${holidays.date} <= ${range.to}`);
  return tx.select().from(holidays).where(and(...where)).orderBy(asc(holidays.date));
}
