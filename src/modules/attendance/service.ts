import { z } from "zod";
import { assertCan, can, ForbiddenError } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, formatDate, monthEnd, todayIn } from "@/lib/dates";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { getBatch } from "@/modules/batches/repo";
import { onRoster } from "@/modules/enrollments/repo";
import { requireStudent } from "@/modules/students/service";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { batchClasses, type ClassRow, type ClassScope, classesOn, enrolledBetween, getClass, markSessionHeld, marksFor, type StudentClass, studentClasses, studentNames, upsertMarks } from "./repo";
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

export type RosterEntry = { studentId: string; name: string; code: string; paused: boolean; mark: Mark | null; note: string | null };
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
  const [roster, marks] = await Promise.all([onRoster(tx, [c.session.batchId], c.session.sessionDate), marksFor(tx, [c.session.id])]);
  const entries = new Map<string, RosterEntry>(roster.map((r) => [r.studentId, { studentId: r.studentId, name: r.name, code: r.code, paused: r.paused, mark: null, note: null }]));
  const extra = await studentNames(tx, marks.filter((m) => !entries.has(m.studentId)).map((m) => m.studentId));
  for (const m of marks) {
    const e = entries.get(m.studentId) ?? { studentId: m.studentId, name: extra.get(m.studentId)?.name ?? "—", code: extra.get(m.studentId)?.code ?? "", paused: false, mark: null, note: null };
    entries.set(m.studentId, { ...e, mark: m.status, note: m.note });
  }
  return [...entries.values()].sort((a, b) => Number(a.paused) - Number(b.paused) || a.name.localeCompare(b.name));
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
});

export async function saveAttendance(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof saveSchema>, opts: { now?: Date } = {}): Promise<{ savedAt: Date; changed: number }> {
  assertCan(ctx, "attendance:mark");
  const now = opts.now ?? new Date();
  const data = saveSchema.parse(input);
  const c = await requireClass(tx, ctx, id);
  const lock = lockOf(ctx, c, todayIn(await timeZone(tx), now), now);
  if (lock === "cancelled") throw new ConflictError(`This class was cancelled${c.session.cancelReason ? ` (${c.session.cancelReason})` : ""}`);
  if (lock === "future") throw new BadRequestError(`This class is on ${formatDate(c.session.sessionDate)}. Mark it on the day.`);
  if (lock === "locked") throw new ForbiddenError("Marks lock 48 hours after the class. Ask a manager to change them.");

  const entries = new Map((await entriesFor(tx, c)).map((e) => [e.studentId, e]));
  const changes: { studentId: string; from: Mark | null; to: Mark; note: string | null }[] = [];
  for (const m of data.marks) {
    const e = entries.get(m.studentId);
    if (!e || (e.paused && !e.mark)) throw new BadRequestError(e ? `${e.name} is paused` : "That student isn't on this class's roster");
    const note = m.note === undefined ? e.note : m.note || null;
    if (e.mark !== m.status || e.note !== note) changes.push({ studentId: m.studentId, from: e.mark, to: m.status, note });
  }
  await upsertMarks(
    tx,
    changes.map((ch) => ({ tenantId: ctx.tenantId, sessionId: id, studentId: ch.studentId, status: ch.to, note: ch.note, markedBy: ctx.staffId, markedAt: now })),
  );
  await markSessionHeld(tx, id);
  if (changes.length) {
    await writeAudit(tx, { ...actor(ctx), action: "attendance.save", entityType: "session", entityId: id, after: { changes: changes.map(({ studentId, from, to }) => ({ studentId, from, to })) } });
  }
  return { savedAt: now, changed: changes.length };
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
  const counted = counts.present + counts.late + counts.absent;
  return { from, to, counts, percent: counted ? Math.round(((counts.present + counts.late) / counted) * 100) : null, recent: classes.slice(-10).reverse() };
}
