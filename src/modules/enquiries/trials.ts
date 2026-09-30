import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, formatDate, timeIn } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { batchClasses, getClass } from "@/modules/attendance/repo";
import type { Mark } from "@/modules/attendance/schema";
import { listBatchViews } from "@/modules/batches/service";
import { assertBatchOpen } from "@/modules/billing/access";
import { getOwnTenant, tenantToday } from "@/modules/tenancy/repo";
import { type EnquiryStatus, OPEN_STATUSES } from "./lists";
import { getEnquiry, getTrial, insertActivity, insertTrial, trialState, trialsOf, updateTrial } from "./repo";
import type { Enquiry } from "./schema";
import { setStatus } from "./service";

// docs/03 §4: a trial in a real class, on its roster, without an enrollment.
// Trial booked while a trial is still to come, Trial done once one is
// attended; a missed one keeps it at Trial booked (agreed 2026-09-25).

const actorOf = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });
const TRIAL_DAYS = 28;

// One "trial" entry on the timeline per event; only open enquiries follow
// their trials, won and lost stay as they are.
async function syncTrialStatus(tx: Tx, ctx: ScopedCtx, e: Enquiry, note: string): Promise<void> {
  const { attended, booked } = await trialState(tx, e.id);
  const to: EnquiryStatus = attended ? "trial_done" : booked ? "trial_booked" : e.status === "new" ? "new" : "contacted";
  if (OPEN_STATUSES.includes(e.status) && to !== e.status) await setStatus(tx, ctx, e, to, {}, { kind: "trial", note });
  else await insertActivity(tx, { tenantId: ctx.tenantId, enquiryId: e.id, kind: "trial", note, staffId: ctx.staffId });
}

async function requireOpen(tx: Tx, ctx: ScopedCtx, id: string): Promise<Enquiry> {
  const e = await getEnquiry(tx, ctx.branchIds, id);
  if (!e) throw new NotFoundError("Enquiry");
  if (!OPEN_STATUSES.includes(e.status)) throw new ConflictError(e.status === "won" ? "This enquiry already joined" : "Reopen it first");
  return e;
}

export type TrialClass = { sessionId: string; date: string; startsAt: Date; endsAt: Date };
export type TrialBatch = { id: string; name: string; programId: string; classes: TrialClass[] };

// The next classes of each running batch, the enquiry's own batch and program first.
export async function trialChoices(tx: Tx, ctx: ScopedCtx, e: Enquiry): Promise<TrialBatch[]> {
  assertCan(ctx, "enquiries:update");
  const today = await tenantToday(tx);
  const out: TrialBatch[] = [];
  for (const b of await listBatchViews(tx, ctx.branchIds)) {
    const classes = (await batchClasses(tx, b.id, today, addDays(today, TRIAL_DAYS))).filter((s) => s.status !== "cancelled").slice(0, 8);
    if (classes.length) out.push({ id: b.id, name: b.name, programId: b.programId, classes: classes.map((s) => ({ sessionId: s.id, date: s.sessionDate, startsAt: s.startsAt, endsAt: s.endsAt })) });
  }
  const rank = (b: TrialBatch) => (b.id === e.batchId ? 0 : b.programId === e.programId ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

export const bookSchema = z.object({ sessionId: z.uuid("Pick a class") });

export async function bookTrial(tx: Tx, ctx: ScopedCtx, enquiryId: string, input: z.input<typeof bookSchema>): Promise<void> {
  assertCan(ctx, "enquiries:update");
  const { sessionId } = bookSchema.parse(input);
  const e = await requireOpen(tx, ctx, enquiryId);
  const c = await getClass(tx, sessionId, { branchIds: ctx.branchIds });
  if (!c) throw new NotFoundError("Class");
  await assertBatchOpen(tx, ctx, c.session.batchId);
  if (c.session.status === "cancelled") throw new ConflictError("That class is cancelled");
  if (c.session.sessionDate < (await tenantToday(tx))) throw new BadRequestError("Pick a class from today on");
  const trial = await insertTrial(tx, { tenantId: ctx.tenantId, enquiryId: e.id, sessionId, trialDate: c.session.sessionDate, createdBy: ctx.staffId }).catch((err: unknown) => {
    if (isUniqueViolation(err)) throw new ConflictError("Already booked for that class");
    throw err;
  });
  const tz = (await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata";
  await syncTrialStatus(tx, ctx, e, `Trial booked · ${c.batchName} · ${formatDate(c.session.sessionDate)}, ${timeIn(tz, c.session.startsAt)}`);
  await writeAudit(tx, { ...actorOf(ctx), action: "enquiry.trial.book", entityType: "enquiry", entityId: e.id, after: { trialId: trial.id, sessionId } });
}

// Before it is marked; kept, never deleted.
export async function cancelTrial(tx: Tx, ctx: ScopedCtx, trialId: string): Promise<void> {
  assertCan(ctx, "enquiries:update");
  const t = await getTrial(tx, trialId);
  if (!t || t.cancelledAt) throw new NotFoundError("Trial");
  const e = await requireOpen(tx, ctx, t.enquiryId);
  if (t.mark) throw new ConflictError("It was already marked on the roster");
  await updateTrial(tx, t.id, { cancelledAt: new Date() });
  const batch = (await trialsOf(tx, e.id)).find((x) => x.id === t.id)?.batchName;
  await syncTrialStatus(tx, ctx, e, `Trial cancelled · ${batch ? `${batch} · ` : ""}${formatDate(t.trialDate)}`);
  await writeAudit(tx, { ...actorOf(ctx), action: "enquiry.trial.cancel", entityType: "enquiry", entityId: e.id, after: { trialId: t.id } });
}

// From the roster: trials are marked like students (attendance:mark, checked
// there), a note becomes the trial's feedback, and each enquiry follows its trials.
const MARK_NOTES: Record<Mark, string> = { present: "Came for the trial", late: "Came for the trial, late", absent: "Missed the trial", excused: "Excused from the trial" };

export async function markTrials(tx: Tx, ctx: ScopedCtx, marks: { trialId: string; mark: Mark; feedback: string | null }[], now: Date): Promise<void> {
  const byEnquiry = new Map<string, Mark>();
  for (const m of marks) byEnquiry.set((await updateTrial(tx, m.trialId, { mark: m.mark, feedback: m.feedback, markedBy: ctx.staffId, markedAt: now })).enquiryId, m.mark);
  for (const [id, mark] of byEnquiry) {
    const e = await getEnquiry(tx, [], id);
    if (e) await syncTrialStatus(tx, ctx, e, MARK_NOTES[mark]);
  }
}
