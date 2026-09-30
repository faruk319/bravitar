import { z } from "zod";
import { assertCan, can, ForbiddenError } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, formatDate, monthEnd, todayIn } from "@/lib/dates";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { getBatch } from "@/modules/batches/repo";
import { assertBatchOpen } from "@/modules/billing/access";
import { onRoster } from "@/modules/enrollments/repo";
import { trialsForSession } from "@/modules/enquiries/repo";
import { markTrials } from "@/modules/enquiries/trials";
import { requireStudent } from "@/modules/students/service";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { batchClasses, type ClassRow, type ClassScope, classesOn, enrolledBetween, getClass, markSessionHeld, marksFor, type StudentClass, staffNames, studentClasses, studentNames, upsertMarks } from "./repo";
import { MARKS, type Mark } from "./schema";

// docs/03 §7 (agreed 2026-09-23): corrections lock 48 hours after the class starts.
export const EDIT_WINDOW_MS = 48 * 3600_000;

const actor = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });

// Teachers see the classes they take; read_all holders see every class in their branches.
function scopeOf(ctx: ScopedCtx): ClassScope {
  return can(ctx, "students", "students:read_all") ? { branchIds: ctx.branchIds } : { branchIds: ctx.branchIds, coachId: ctx.staffId };
}

async function timeZone(tx: Tx): Promise<string> {
  return (await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata";
}

export type ClassCard = ClassRow & { students: number; marked: number };

export async function todaysClasses(tx: Tx, ctx: ScopedCtx, opts: { now?: Date } = {}): Promise<{ date: string; timeZone: string; classes: ClassCard[] }> {
  assertCan(ctx, "sessions:read");
  const tz = await timeZone(tx);
  const date = todayIn(tz, opts.now);
  const rows = await classesOn(tx, date, scopeOf(ctx));
  const roster = await onRoster(tx, [...new Set(rows.map((r) => r.session.batchId))], date);
  const marks = await marksFor(tx, rows.map((r) => r.session.id));
  return {
    date,
    timeZone: tz,
    classes: rows.map((r) => ({
      ...r,
      students: roster.filter((e) => e.batchId === r.session.batchId && !e.paused).length,
      marked: marks.filter((m) => m.sessionId === r.session.id).length,
    })),
  };
}

// A trial (docs/03 §4) is on the roster by its trial id, marked like a student.
export type RosterEntry = { studentId: string; name: string; code: string; paused: boolean; trial: boolean; mark: Mark | null; note: string | null; markedBy: string | null };
export type Lock = "cancelled" | "future" | "locked";
export type ClassView = ClassRow & { timeZone: string; entries: RosterEntry[]; lock: Lock | null; canMark: boolean };

function lockOf(ctx: ScopedCtx, c: ClassRow, today: string, now: Date): Lock | null {
  if (c.session.status === "cancelled") return "cancelled";
  if (c.session.sessionDate > today) return "future";
  if (now.getTime() - c.session.startsAt.getTime() > EDIT_WINDOW_MS && !can(ctx, "attendance", "attendance:amend")) return "locked";
  return null;
}

async function requireClass(tx: Tx, ctx: ScopedCtx, id: string): Promise<ClassRow> {
  const c = await getClass(tx, id, scopeOf(ctx));
  if (!c) throw new NotFoundError("Class");
  return c;
}

// Enrolled on the class date, plus anyone already marked (history survives moves).
async function entriesFor(tx: Tx, c: ClassRow): Promise<RosterEntry[]> {
  const [roster, marks, trials] = await Promise.all([onRoster(tx, [c.session.batchId], c.session.sessionDate), marksFor(tx, [c.session.id]), trialsForSession(tx, c.session.id)]);
  const entries = new Map<string, RosterEntry>(roster.map((r) => [r.studentId, { studentId: r.studentId, name: r.name, code: r.code, paused: r.paused, trial: false, mark: null, note: null, markedBy: null }]));
  const extra = await studentNames(tx, marks.filter((m) => !entries.has(m.studentId)).map((m) => m.studentId));
  for (const m of marks) {
    const e = entries.get(m.studentId) ?? { studentId: m.studentId, name: extra.get(m.studentId)?.name ?? "—", code: extra.get(m.studentId)?.code ?? "", paused: false, trial: false, mark: null, note: null, markedBy: null };
    entries.set(m.studentId, { ...e, mark: m.status, note: m.note, markedBy: m.markedBy });
  }
  // Once they joined and are on this roster as a student, that row is theirs.
  for (const t of trials) if (!(t.studentId && entries.has(t.studentId))) entries.set(t.id, { studentId: t.id, name: t.name, code: "", paused: false, trial: true, mark: t.mark, note: t.feedback, markedBy: t.markedBy });
  const order = (e: RosterEntry) => (e.paused ? 2 : e.trial ? 1 : 0);
  return [...entries.values()].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

export async function classRoster(tx: Tx, ctx: ScopedCtx, id: string, opts: { now?: Date } = {}): Promise<ClassView> {
  assertCan(ctx, "sessions:read");
  const now = opts.now ?? new Date();
  const c = await requireClass(tx, ctx, id);
  const tz = await timeZone(tx);
  const lock = lockOf(ctx, c, todayIn(tz, now), now);
  return { ...c, timeZone: tz, entries: await entriesFor(tx, c), lock, canMark: !lock && can(ctx, "attendance", "attendance:mark") };
}

export const saveSchema = z.object({
  marks: z
    .array(z.object({ studentId: z.uuid(), status: z.enum(MARKS), note: z.string().trim().max(300).nullable().optional() }))
    .min(1)
    .max(500),
  source: z.enum(["staff", "offline_sync"]).default("staff"),
});

// A mark that replaced someone else's: last write wins, but the screen says so.
export type Conflict = { studentId: string; name: string; from: Mark; to: Mark; by: string };

export async function saveAttendance(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof saveSchema>, opts: { now?: Date } = {}): Promise<{ savedAt: Date; changed: number; conflicts: Conflict[] }> {
  assertCan(ctx, "attendance:mark");
  const now = opts.now ?? new Date();
  const data = saveSchema.parse(input);
  const c = await requireClass(tx, ctx, id);
  await assertBatchOpen(tx, ctx, c.session.batchId);
  const lock = lockOf(ctx, c, todayIn(await timeZone(tx), now), now);
  if (lock === "cancelled") throw new ConflictError(`This class was cancelled${c.session.cancelReason ? ` (${c.session.cancelReason})` : ""}`);
  if (lock === "future") throw new BadRequestError(`This class is on ${formatDate(c.session.sessionDate)}. Mark it on the day.`);
  if (lock === "locked") throw new ForbiddenError("Marks lock 48 hours after the class. Ask a manager to change them.");

  const entries = new Map((await entriesFor(tx, c)).map((e) => [e.studentId, e]));
  const changes: { studentId: string; from: Mark | null; to: Mark; note: string | null; by: string | null }[] = [];
  for (const m of data.marks) {
    const e = entries.get(m.studentId);
    if (!e || (e.paused && !e.mark)) throw new BadRequestError(e ? `${e.name} is paused` : "That student isn't on this class's roster");
    const note = m.note === undefined ? e.note : m.note || null;
    if (e.mark !== m.status || e.note !== note) changes.push({ studentId: m.studentId, from: e.mark, to: m.status, note, by: e.markedBy });
  }
  const isTrial = (ch: { studentId: string }) => Boolean(entries.get(ch.studentId)?.trial);
  await upsertMarks(
    tx,
    changes.filter((ch) => !isTrial(ch)).map((ch) => ({ tenantId: ctx.tenantId, sessionId: id, studentId: ch.studentId, status: ch.to, note: ch.note, markedBy: ctx.staffId, markedAt: now, source: data.source })),
  );
  await markTrials(tx, ctx, changes.filter(isTrial).map((ch) => ({ trialId: ch.studentId, mark: ch.to, feedback: ch.note })), now);
  await markSessionHeld(tx, id);
  if (changes.length) {
    await writeAudit(tx, { ...actor(ctx), action: "attendance.save", entityType: "session", entityId: id, after: { changes: changes.map(({ studentId, from, to }) => ({ studentId, from, to })) } });
  }
  const overwritten = changes.filter((ch) => ch.from && ch.from !== ch.to && ch.by && ch.by !== ctx.staffId);
  const names = await staffNames(tx, [...new Set(overwritten.map((ch) => ch.by ?? ""))]);
  const conflicts = overwritten.map((ch) => ({ studentId: ch.studentId, name: entries.get(ch.studentId)?.name ?? "—", from: ch.from as Mark, to: ch.to, by: names.get(ch.by ?? "") ?? "someone" }));
  return { savedAt: now, changed: changes.length, conflicts };
}

export type MonthGrid = {
  batch: { id: string; name: string };
  month: string;
  classes: { id: string; date: string; status: string; cancelReason: string | null }[];
  students: { id: string; name: string; code: string }[];
  marks: Record<string, Mark>; // `${studentId}|${sessionId}`
};

// docs/03 §7: the monthly register for one batch.
export async function monthGrid(tx: Tx, ctx: ScopedCtx, batchId: string, month: string): Promise<MonthGrid> {
  assertCan(ctx, "attendance:read");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestError("Pick a month");
  const batch = await getBatch(tx, ctx.branchIds, batchId);
  if (!batch) throw new NotFoundError("Batch");
  const from = `${month}-01`;
  const to = monthEnd(month);
  const [classes, enrolled] = await Promise.all([batchClasses(tx, batchId, from, to), enrolledBetween(tx, batchId, from, to)]);
  const marks = await marksFor(tx, classes.map((c) => c.id));
  const known = new Set(enrolled.map((s) => s.id));
  const extra = [...new Set(marks.map((m) => m.studentId).filter((id) => !known.has(id)))];
  const names = await studentNames(tx, extra);
  return {
    batch: { id: batch.id, name: batch.name },
    month,
    classes: classes.map((c) => ({ id: c.id, date: c.sessionDate, status: c.status, cancelReason: c.cancelReason })),
    students: [...enrolled, ...extra.map((id) => ({ id, name: names.get(id)?.name ?? "—", code: names.get(id)?.code ?? "" }))],
    marks: Object.fromEntries(marks.map((m) => [`${m.studentId}|${m.sessionId}`, m.status])),
  };
}

export type StudentAttendance = { from: string; to: string; counts: Record<Mark | "unmarked", number>; percent: number | null; recent: StudentClass[] };

// Last 30 days. % = (present + late) / (present + late + absent); unmarked and excused don't count.
export async function studentAttendance(tx: Tx, ctx: ScopedCtx, studentId: string, opts: { now?: Date } = {}): Promise<StudentAttendance> {
  await requireStudent(tx, ctx, studentId);
  const now = opts.now ?? new Date();
  const to = todayIn(await timeZone(tx), now);
  const from = addDays(to, -29);
  const classes = await studentClasses(tx, studentId, from, to, now);
  const counts: StudentAttendance["counts"] = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
  for (const c of classes) counts[c.mark ?? "unmarked"]++;
  return { from, to, counts, percent: attendancePercent(counts), recent: classes.slice(-10).reverse() };
}

// docs/03 §7: (present + late) / (present + late + absent); unmarked and excused
// don't count. Null when nothing counted.
export function attendancePercent(c: { present: number; late: number; absent: number }): number | null {
  const counted = c.present + c.late + c.absent;
  return counted ? Math.round(((c.present + c.late) / counted) * 100) : null;
}
