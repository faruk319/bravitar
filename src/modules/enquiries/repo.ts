import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, type SQL, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import type { Mark } from "@/modules/attendance/schema";
import { batches, programs } from "@/modules/batches/schema";
import { sessions } from "@/modules/sessions/schema";
import { staffUsers } from "@/modules/staff/schema";
import { type EnquiryStatus, OPEN_STATUSES } from "./lists";
import { type Enquiry, type EnquiryActivity, enquiries, enquiryActivities, type TrialAttendance, trialAttendances } from "./schema";

// Branch scoping is an explicit filter (docs/01): `branchIds` empty = all.
const inScope = (branchIds: string[]): SQL | undefined => and(isNull(enquiries.deletedAt), branchIds.length ? inArray(enquiries.branchId, branchIds) : undefined);
const open = inArray(enquiries.status, [...OPEN_STATUSES]);

export async function insertEnquiry(tx: Tx, row: Omit<typeof enquiries.$inferInsert, "id">): Promise<Enquiry> {
  const [e] = await tx
    .insert(enquiries)
    .values({ id: uuidv7(), ...row })
    .returning();
  if (!e) throw new Error("enquiry insert returned no row");
  return e;
}

export async function getEnquiry(tx: Tx, branchIds: string[], id: string): Promise<Enquiry | undefined> {
  const [e] = await tx.select().from(enquiries).where(and(eq(enquiries.id, id), inScope(branchIds)));
  return e;
}

export async function updateEnquiry(tx: Tx, id: string, patch: Partial<typeof enquiries.$inferInsert>): Promise<Enquiry> {
  const [e] = await tx.update(enquiries).set(patch).where(eq(enquiries.id, id)).returning();
  if (!e) throw new Error("enquiry update matched no row");
  return e;
}

export type EnquiryRow = Enquiry & { programName: string | null; batchName: string | null; ownerName: string | null };

const rows = (tx: Tx) =>
  tx
    .select({ e: enquiries, programName: programs.name, batchName: batches.name, ownerName: staffUsers.fullName })
    .from(enquiries)
    .leftJoin(programs, eq(programs.id, enquiries.programId))
    .leftJoin(batches, eq(batches.id, enquiries.batchId))
    .leftJoin(staffUsers, eq(staffUsers.id, enquiries.ownerStaffId));
const flat = (r: { e: Enquiry; programName: string | null; batchName: string | null; ownerName: string | null }): EnquiryRow => ({ ...r.e, programName: r.programName, batchName: r.batchName, ownerName: r.ownerName });

export async function enquiryRow(tx: Tx, branchIds: string[], id: string): Promise<EnquiryRow | undefined> {
  const [r] = await rows(tx).where(and(eq(enquiries.id, id), inScope(branchIds)));
  return r ? flat(r) : undefined;
}

export async function listByStatus(tx: Tx, branchIds: string[], status: EnquiryStatus, limit = 200): Promise<EnquiryRow[]> {
  const list = await rows(tx)
    .where(and(inScope(branchIds), eq(enquiries.status, status)))
    .orderBy(desc(enquiries.createdAt), desc(enquiries.id))
    .limit(limit);
  return list.map(flat);
}

// Open enquiries due for a follow-up by `today`; someone's own first.
export async function followUpsDue(tx: Tx, branchIds: string[], today: string, opts: { staffId?: string; mineFirst?: string } = {}): Promise<EnquiryRow[]> {
  const list = await rows(tx)
    .where(and(inScope(branchIds), open, lte(enquiries.nextFollowUp, today), opts.staffId ? eq(enquiries.ownerStaffId, opts.staffId) : undefined))
    .orderBy(...(opts.mineFirst ? [desc(sql`${enquiries.ownerStaffId} = ${opts.mineFirst}`)] : []), asc(enquiries.nextFollowUp), asc(enquiries.createdAt))
    .limit(200);
  return list.map(flat);
}

export async function statusCounts(tx: Tx, branchIds: string[], today: string): Promise<Record<EnquiryStatus | "follow_ups", number>> {
  const [r] = await tx
    .select({
      new: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'new')::int`,
      contacted: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'contacted')::int`,
      trial_booked: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'trial_booked')::int`,
      trial_done: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'trial_done')::int`,
      won: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'won')::int`,
      lost: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'lost')::int`,
      follow_ups: sql<number>`count(*) FILTER (WHERE ${open} AND ${enquiries.nextFollowUp} <= ${today})::int`,
    })
    .from(enquiries)
    .where(inScope(branchIds));
  return r ?? { new: 0, contacted: 0, trial_booked: 0, trial_done: 0, won: 0, lost: 0, follow_ups: 0 };
}

// Other open enquiries on this phone, for the add form's note.
export async function openByPhone(tx: Tx, phone: string, except?: string): Promise<Pick<Enquiry, "id" | "name">[]> {
  return tx
    .select({ id: enquiries.id, name: enquiries.name })
    .from(enquiries)
    .where(and(isNull(enquiries.deletedAt), open, eq(enquiries.phone, phone), except ? sql`${enquiries.id} <> ${except}` : undefined))
    .limit(5);
}

export async function insertActivity(tx: Tx, row: Omit<typeof enquiryActivities.$inferInsert, "id">): Promise<void> {
  await tx.insert(enquiryActivities).values({ id: uuidv7(), ...row });
}

export type ActivityRow = EnquiryActivity & { staffName: string | null };

export async function activitiesOf(tx: Tx, enquiryId: string): Promise<ActivityRow[]> {
  const list = await tx
    .select({ a: enquiryActivities, staffName: staffUsers.fullName })
    .from(enquiryActivities)
    .leftJoin(staffUsers, eq(staffUsers.id, enquiryActivities.staffId))
    .where(eq(enquiryActivities.enquiryId, enquiryId))
    .orderBy(desc(enquiryActivities.happenedAt), desc(enquiryActivities.id));
  return list.map((r) => ({ ...r.a, staffName: r.staffName }));
}

// ---- trials

const live = isNull(trialAttendances.cancelledAt);

export async function insertTrial(tx: Tx, row: Omit<typeof trialAttendances.$inferInsert, "id">): Promise<TrialAttendance> {
  const [t] = await tx
    .insert(trialAttendances)
    .values({ id: uuidv7(), ...row })
    .returning();
  if (!t) throw new Error("trial insert returned no row");
  return t;
}

export async function getTrial(tx: Tx, id: string): Promise<TrialAttendance | undefined> {
  const [t] = await tx.select().from(trialAttendances).where(eq(trialAttendances.id, id));
  return t;
}

export async function updateTrial(tx: Tx, id: string, patch: Partial<typeof trialAttendances.$inferInsert>): Promise<TrialAttendance> {
  const [t] = await tx.update(trialAttendances).set(patch).where(eq(trialAttendances.id, id)).returning();
  if (!t) throw new Error("trial update matched no row");
  return t;
}

export type TrialRow = TrialAttendance & { batchId: string; batchName: string; startsAt: Date; endsAt: Date; sessionStatus: string };

// An enquiry's trials with their classes, newest first; cancelled ones too.
export async function trialsOf(tx: Tx, enquiryId: string): Promise<TrialRow[]> {
  const list = await tx
    .select({ t: trialAttendances, batchId: sessions.batchId, batchName: batches.name, startsAt: sessions.startsAt, endsAt: sessions.endsAt, sessionStatus: sessions.status })
    .from(trialAttendances)
    .innerJoin(sessions, eq(sessions.id, trialAttendances.sessionId))
    .innerJoin(batches, eq(batches.id, sessions.batchId))
    .where(eq(trialAttendances.enquiryId, enquiryId))
    .orderBy(desc(sessions.startsAt));
  return list.map((r) => ({ ...r.t, batchId: r.batchId, batchName: r.batchName, startsAt: r.startsAt, endsAt: r.endsAt, sessionStatus: r.sessionStatus }));
}

export type RosterTrial = { id: string; enquiryId: string; name: string; mark: Mark | null; feedback: string | null; markedBy: string | null };

// The class's live trials, for its roster.
export async function trialsForSession(tx: Tx, sessionId: string): Promise<RosterTrial[]> {
  return tx
    .select({ id: trialAttendances.id, enquiryId: trialAttendances.enquiryId, name: enquiries.name, mark: trialAttendances.mark, feedback: trialAttendances.feedback, markedBy: trialAttendances.markedBy })
    .from(trialAttendances)
    .innerJoin(enquiries, eq(enquiries.id, trialAttendances.enquiryId))
    .where(and(eq(trialAttendances.sessionId, sessionId), live, isNull(enquiries.deletedAt)));
}

// Whether an enquiry has a live trial attended, or at least one still to come.
export async function trialState(tx: Tx, enquiryId: string): Promise<{ attended: boolean; booked: boolean }> {
  const [r] = await tx
    .select({
      attended: sql<boolean>`coalesce(bool_or(${trialAttendances.mark} IN ('present', 'late')), false)`,
      booked: sql<boolean>`count(*) FILTER (WHERE ${sessions.status} <> 'cancelled') > 0`,
    })
    .from(trialAttendances)
    .innerJoin(sessions, eq(sessions.id, trialAttendances.sessionId))
    .where(and(eq(trialAttendances.enquiryId, enquiryId), live));
  return { attended: Boolean(r?.attended), booked: Boolean(r?.booked) };
}

// ---- the report: enquiries received in [from, to)

export type Funnel = { received: number; contacted: number; trialBooked: number; trialDone: number; won: number; lost: number };

export async function funnel(tx: Tx, branchIds: string[], from: Date, to: Date): Promise<Funnel> {
  const [r] = await tx
    .select({
      received: sql<number>`count(*)::int`,
      contacted: sql<number>`count(${enquiries.contactedAt})::int`,
      trialBooked: sql<number>`count(${enquiries.trialBookedAt})::int`,
      trialDone: sql<number>`count(${enquiries.trialDoneAt})::int`,
      won: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'won')::int`,
      lost: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'lost')::int`,
    })
    .from(enquiries)
    .where(and(inScope(branchIds), gte(enquiries.createdAt, from), lt(enquiries.createdAt, to)));
  return r ?? { received: 0, contacted: 0, trialBooked: 0, trialDone: 0, won: 0, lost: 0 };
}

export async function bySource(tx: Tx, branchIds: string[], from: Date, to: Date): Promise<{ source: Enquiry["source"]; received: number; won: number }[]> {
  return tx
    .select({ source: enquiries.source, received: sql<number>`count(*)::int`, won: sql<number>`count(*) FILTER (WHERE ${enquiries.status} = 'won')::int` })
    .from(enquiries)
    .where(and(inScope(branchIds), gte(enquiries.createdAt, from), lt(enquiries.createdAt, to)))
    .groupBy(enquiries.source)
    .orderBy(desc(sql`count(*)`));
}

export async function lostReasons(tx: Tx, branchIds: string[], from: Date, to: Date): Promise<{ reason: Enquiry["lostReason"]; count: number }[]> {
  return tx
    .select({ reason: enquiries.lostReason, count: sql<number>`count(*)::int` })
    .from(enquiries)
    .where(and(inScope(branchIds), eq(enquiries.status, "lost"), gte(enquiries.createdAt, from), lt(enquiries.createdAt, to)))
    .groupBy(enquiries.lostReason)
    .orderBy(desc(sql`count(*)`));
}
