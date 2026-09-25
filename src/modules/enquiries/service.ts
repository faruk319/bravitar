import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, isIsoDate } from "@/lib/dates";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { phoneSchema } from "@/lib/phone";
import { getBatch, getProgram } from "@/modules/batches/repo";
import { getStaff } from "@/modules/staff/repo";
import { type HouseholdSuggestion, lookupGuardian } from "@/modules/students/service";
import { pickBranch } from "@/modules/tenancy/branch-access";
import { localToUtc } from "@/modules/sessions/occurrences";
import { getOwnTenant, tenantToday } from "@/modules/tenancy/repo";
import { type ActivityKind, type EnquiryStatus, ENQUIRY_STATUSES, LOST_REASONS, OPEN_STATUSES, SOURCES } from "./lists";
import { type ActivityRow, activitiesOf, bySource, type EnquiryRow, enquiryRow, followUpsDue, type Funnel, funnel, getEnquiry, insertActivity, insertEnquiry, listByStatus, lostReasons, openByPhone, statusCounts, updateEnquiry } from "./repo";
import type { Enquiry } from "./schema";

const actorOf = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });
const isoDate = z.string().refine(isIsoDate, "use YYYY-MM-DD");

async function requireEnquiry(tx: Tx, ctx: ScopedCtx, id: string): Promise<Enquiry> {
  const e = await getEnquiry(tx, ctx.branchIds, id);
  if (!e) throw new NotFoundError("Enquiry");
  return e;
}

// Program, batch and the assigned person must be this academy's, and the batch the program's.
async function checkLinks(tx: Tx, ctx: ScopedCtx, d: { programId?: string | null | undefined; batchId?: string | null | undefined; ownerStaffId?: string | null | undefined }): Promise<void> {
  if (d.programId && !(await getProgram(tx, d.programId))) throw new NotFoundError("Program");
  if (d.batchId) {
    const b = await getBatch(tx, ctx.branchIds, d.batchId);
    if (!b) throw new NotFoundError("Batch");
    if (d.programId && b.programId !== d.programId) throw new BadRequestError("That batch is in another program");
  }
  if (d.ownerStaffId && !(await getStaff(tx, d.ownerStaffId))?.isActive) throw new NotFoundError("Staff member");
}

// The first time each stage is reached is kept for the funnel (docs/03 §4);
// any step forward means they were contacted.
const REACHED: Partial<Record<EnquiryStatus, (keyof Enquiry)[]>> = {
  contacted: ["contactedAt"],
  trial_booked: ["contactedAt", "trialBookedAt"],
  trial_done: ["contactedAt", "trialBookedAt", "trialDoneAt"],
  won: ["contactedAt", "wonAt"],
};

// One timeline entry: the event that moved it (a call, a trial) or a plain
// status change, carrying the status it led to.
export async function setStatus(tx: Tx, ctx: ScopedCtx, e: Enquiry, to: EnquiryStatus, patch: Partial<Enquiry> = {}, event: { kind?: ActivityKind; note?: string | undefined } = {}): Promise<Enquiry> {
  const now = new Date();
  const note = event.note;
  const stamps = Object.fromEntries((REACHED[to] ?? []).filter((k) => !e[k]).map((k) => [k, now]));
  const after = await updateEnquiry(tx, e.id, { ...patch, ...stamps, status: to });
  await insertActivity(tx, { tenantId: ctx.tenantId, enquiryId: e.id, kind: event.kind ?? "status_change", toStatus: to, note: note ?? null, staffId: ctx.staffId });
  await writeAudit(tx, { ...actorOf(ctx), action: "enquiry.status", entityType: "enquiry", entityId: e.id, before: { status: e.status }, after: { status: to, ...(note ? { note } : {}) } });
  return after;
}

// ---- add (docs/06 Prompt 18: name, phone and program in 15 seconds)

export const newEnquirySchema = z.object({
  name: z.string().trim().min(2, "Add the student's name").max(120),
  phone: phoneSchema,
  programId: z.uuid("Pick a program"),
  contactName: z.string().trim().max(120).optional(),
  source: z.enum(SOURCES).optional(),
  batchId: z.uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
  nextFollowUp: isoDate.optional(),
  ownerStaffId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});

export async function createEnquiry(tx: Tx, ctx: ScopedCtx, input: z.input<typeof newEnquirySchema>): Promise<Enquiry> {
  assertCan(ctx, "enquiries:create");
  const d = newEnquirySchema.parse(input);
  await checkLinks(tx, ctx, d);
  const e = await insertEnquiry(tx, {
    tenantId: ctx.tenantId,
    branchId: await pickBranch(tx, ctx.branchIds, d.branchId),
    name: d.name,
    phone: d.phone,
    contactName: d.contactName || null,
    source: d.source ?? null,
    programId: d.programId,
    batchId: d.batchId ?? null,
    notes: d.notes || null,
    nextFollowUp: d.nextFollowUp ?? addDays(await tenantToday(tx), 1),
    ownerStaffId: d.ownerStaffId ?? ctx.staffId,
    createdBy: ctx.staffId,
  });
  await insertActivity(tx, { tenantId: ctx.tenantId, enquiryId: e.id, kind: "status_change", toStatus: "new", staffId: ctx.staffId });
  await writeAudit(tx, { ...actorOf(ctx), action: "enquiry.create", entityType: "enquiry", entityId: e.id, after: { name: e.name, programId: e.programId, source: e.source } });
  return e;
}

// The add form's note: this phone is already on an open enquiry, or a family.
export type PhoneMatch = { enquiries: { id: string; name: string }[]; family: HouseholdSuggestion | undefined };

export async function phoneMatches(tx: Tx, ctx: ScopedCtx, phone: string, except?: string): Promise<PhoneMatch> {
  assertCan(ctx, "enquiries:read");
  const p = phoneSchema.safeParse(phone);
  if (!p.success) return { enquiries: [], family: undefined };
  return { enquiries: await openByPhone(tx, p.data, except), family: await lookupGuardian(tx, p.data) };
}

// ---- the board

export const BOARD_VIEWS = ["follow_ups", ...ENQUIRY_STATUSES] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

export async function enquiryBoard(tx: Tx, ctx: ScopedCtx, view: BoardView): Promise<{ counts: Awaited<ReturnType<typeof statusCounts>>; rows: EnquiryRow[]; today: string }> {
  assertCan(ctx, "enquiries:read");
  const today = await tenantToday(tx);
  const rows = view === "follow_ups" ? await followUpsDue(tx, ctx.branchIds, today, { mineFirst: ctx.staffId }) : await listByStatus(tx, ctx.branchIds, view);
  return { counts: await statusCounts(tx, ctx.branchIds, today), rows, today };
}

// docs/03 §4: a follow-up due today shows on the assigned person's dashboard.
export async function myFollowUps(tx: Tx, ctx: ScopedCtx): Promise<EnquiryRow[]> {
  assertCan(ctx, "enquiries:read");
  return followUpsDue(tx, ctx.branchIds, await tenantToday(tx), { staffId: ctx.staffId });
}

export type EnquiryDetail = { enquiry: EnquiryRow; activities: ActivityRow[]; matches: PhoneMatch; today: string };

export async function enquiryDetail(tx: Tx, ctx: ScopedCtx, id: string): Promise<EnquiryDetail> {
  assertCan(ctx, "enquiries:read");
  const enquiry = await enquiryRow(tx, ctx.branchIds, id);
  if (!enquiry) throw new NotFoundError("Enquiry");
  return { enquiry, activities: await activitiesOf(tx, id), matches: await phoneMatches(tx, ctx, enquiry.phone, id), today: await tenantToday(tx) };
}

// ---- working it

export const activitySchema = z.object({
  kind: z.enum(["call", "whatsapp", "visit", "note"]),
  note: z.string().trim().max(1000).optional(),
  nextFollowUp: isoDate.nullable().optional(), // null: no more follow-ups
});

// The first call, message or visit moves a new enquiry to Contacted.
export async function logActivity(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof activitySchema>): Promise<Enquiry> {
  assertCan(ctx, "enquiries:update");
  const d = activitySchema.parse(input);
  const e = await requireEnquiry(tx, ctx, id);
  if (d.kind === "note" && !d.note) throw new BadRequestError("Write the note");
  const patch = d.nextFollowUp !== undefined ? { nextFollowUp: d.nextFollowUp } : {};
  if (d.kind !== "note" && e.status === "new") return setStatus(tx, ctx, e, "contacted", patch, { kind: d.kind, note: d.note || undefined });
  await insertActivity(tx, { tenantId: ctx.tenantId, enquiryId: id, kind: d.kind, note: d.note || null, staffId: ctx.staffId });
  return Object.keys(patch).length ? updateEnquiry(tx, id, patch) : e;
}

export const editSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  source: z.enum(SOURCES).nullable().optional(),
  programId: z.uuid().optional(),
  batchId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  nextFollowUp: isoDate.nullable().optional(),
  ownerStaffId: z.uuid().optional(),
});

export async function editEnquiry(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof editSchema>): Promise<Enquiry> {
  assertCan(ctx, "enquiries:update");
  const d = editSchema.parse(input);
  const e = await requireEnquiry(tx, ctx, id);
  await checkLinks(tx, ctx, { programId: d.programId ?? e.programId, batchId: d.batchId === undefined ? e.batchId : d.batchId, ownerStaffId: d.ownerStaffId });
  const patch = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === "" ? null : v])) as Partial<Enquiry>;
  const after = await updateEnquiry(tx, id, patch);
  await writeAudit(tx, { ...actorOf(ctx), action: "enquiry.update", entityType: "enquiry", entityId: id, after: patch });
  return after;
}

export const lostSchema = z.object({ reason: z.enum(LOST_REASONS, "Pick a reason"), note: z.string().trim().max(500).optional() });

// docs/03 §4: a reason from the fixed list, plus an optional note.
export async function markLost(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof lostSchema>): Promise<Enquiry> {
  assertCan(ctx, "enquiries:update");
  const d = lostSchema.parse(input);
  const e = await requireEnquiry(tx, ctx, id);
  if (!OPEN_STATUSES.includes(e.status)) throw new ConflictError(e.status === "won" ? "This enquiry already joined" : "Already lost");
  return setStatus(tx, ctx, e, "lost", { lostReason: d.reason, lostNote: d.note || null, lostAt: new Date(), nextFollowUp: null }, { note: d.note });
}

// Back to Contacted, with a follow-up tomorrow.
export async function reopenEnquiry(tx: Tx, ctx: ScopedCtx, id: string): Promise<Enquiry> {
  assertCan(ctx, "enquiries:update");
  const e = await requireEnquiry(tx, ctx, id);
  if (e.status !== "lost") throw new ConflictError("Only a lost enquiry can be reopened");
  return setStatus(tx, ctx, e, "contacted", { lostReason: null, lostNote: null, lostAt: null, nextFollowUp: addDays(await tenantToday(tx), 1) });
}

// ---- the report (docs/03 §4): enquiries received in a date range, in the academy's days

export const reportSchema = z.object({ from: isoDate, to: isoDate }).refine((r) => r.from <= r.to, "The start comes after the end");
export type EnquiryReport = { from: string; to: string; funnel: Funnel; sources: Awaited<ReturnType<typeof bySource>>; lost: Awaited<ReturnType<typeof lostReasons>> };

export async function enquiryReport(tx: Tx, ctx: ScopedCtx, input: z.input<typeof reportSchema>): Promise<EnquiryReport> {
  assertCan(ctx, "enquiries:read");
  const { from, to } = reportSchema.parse(input);
  const tz = (await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata";
  const [start, end] = [localToUtc(from, "00:00", tz), localToUtc(addDays(to, 1), "00:00", tz)];
  return { from, to, funnel: await funnel(tx, ctx.branchIds, start, end), sources: await bySource(tx, ctx.branchIds, start, end), lost: await lostReasons(tx, ctx.branchIds, start, end) };
}
