import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, formatDate, isIsoDate } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { getBatch } from "@/modules/batches/repo";
import type { Batch } from "@/modules/batches/schema";
import { type BatchView, listBatchViews } from "@/modules/batches/service";
import { endCharges } from "@/modules/fees/invoicing";
import { getPlan } from "@/modules/fees/repo";
import { requireStudent } from "@/modules/students/service";
import { tenantToday } from "@/modules/tenancy/repo";
import { enrollmentsOfStudent, findOverlap, getEnrollment, insertEnrollment, type RosterRow, rosterOf, type StudentEnrollment, updateEnrollment } from "./repo";
import type { Enrollment } from "./schema";

const actor = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });
const isoDate = z.string().refine(isIsoDate, "Pick a date");

async function openBatch(tx: Tx, ctx: ScopedCtx, id: string): Promise<Batch> {
  const b = await getBatch(tx, ctx.branchIds, id);
  if (!b) throw new NotFoundError("Batch");
  if (b.status === "ended") throw new ConflictError(`${b.name} is closed`);
  return b;
}

async function requireOpen(tx: Tx, ctx: ScopedCtx, id: string): Promise<Enrollment> {
  const e = await getEnrollment(tx, id);
  if (!e) throw new NotFoundError("Enrollment");
  await requireStudent(tx, ctx, e.studentId);
  if (e.status !== "active" && e.status !== "paused") throw new ConflictError("No longer in this batch");
  return e;
}

async function join(tx: Tx, ctx: ScopedCtx, studentId: string, batch: Batch, start: string): Promise<Enrollment> {
  if (start < batch.startDate) throw new BadRequestError(`${batch.name} starts on ${formatDate(batch.startDate)}`);
  if (await findOverlap(tx, studentId, batch.id, start)) throw new ConflictError(`Already in ${batch.name}`);
  const plan = batch.defaultFeePlanId ? await getPlan(tx, batch.defaultFeePlanId) : undefined;
  try {
    return await insertEnrollment(tx, { tenantId: ctx.tenantId, studentId, batchId: batch.id, startDate: start, feePlanId: plan?.isActive ? plan.id : null });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Already in ${batch.name}`);
    throw e;
  }
}

export const enrollSchema = z.object({ studentId: z.uuid(), batchId: z.uuid(), startDate: isoDate.optional() });

export async function enroll(tx: Tx, ctx: ScopedCtx, input: z.input<typeof enrollSchema>): Promise<Enrollment> {
  assertCan(ctx, "enrollments:manage");
  const data = enrollSchema.parse(input);
  const student = await requireStudent(tx, ctx, data.studentId);
  if (student.status !== "active") throw new ConflictError("Only active students can join a batch");
  const batch = await openBatch(tx, ctx, data.batchId);
  const e = await join(tx, ctx, student.id, batch, data.startDate ?? (await tenantToday(tx)));
  await writeAudit(tx, { ...actor(ctx), action: "enrollment.create", entityType: "enrollment", entityId: e.id, after: { studentId: e.studentId, batchId: e.batchId, startDate: e.startDate } });
  return e;
}

export async function pauseEnrollment(tx: Tx, ctx: ScopedCtx, id: string): Promise<Enrollment> {
  assertCan(ctx, "enrollments:manage");
  const e = await requireOpen(tx, ctx, id);
  if (e.status === "paused") throw new ConflictError("Already paused");
  const after = await updateEnrollment(tx, id, { status: "paused", pausedOn: await tenantToday(tx) });
  await writeAudit(tx, { ...actor(ctx), action: "enrollment.pause", entityType: "enrollment", entityId: id, after: { pausedOn: after.pausedOn } });
  return after;
}

export async function resumeEnrollment(tx: Tx, ctx: ScopedCtx, id: string): Promise<Enrollment> {
  assertCan(ctx, "enrollments:manage");
  const e = await requireOpen(tx, ctx, id);
  if (e.status !== "paused") throw new ConflictError("Not paused");
  const after = await updateEnrollment(tx, id, { status: "active", pausedOn: null });
  await writeAudit(tx, { ...actor(ctx), action: "enrollment.resume", entityType: "enrollment", entityId: id, before: { pausedOn: e.pausedOn } });
  return after;
}

export const transferSchema = z.object({ batchId: z.uuid(), date: isoDate.optional() });

// docs/02 §7: the old enrollment is closed and linked, never re-pointed.
export async function transferEnrollment(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof transferSchema>): Promise<Enrollment> {
  assertCan(ctx, "enrollments:manage");
  const data = transferSchema.parse(input);
  const old = await requireOpen(tx, ctx, id);
  if (data.batchId === old.batchId) throw new BadRequestError("Pick a different batch");
  const target = await openBatch(tx, ctx, data.batchId);
  const date = data.date ?? (await tenantToday(tx));
  if (date < old.startDate) throw new BadRequestError("The move can't be before they joined");
  const next = await join(tx, ctx, old.studentId, target, date);
  await updateEnrollment(tx, old.id, { status: "transferred", endDate: addDays(date, -1), pausedOn: null, transferredToEnrollmentId: next.id });
  await endCharges(tx, actor(ctx), [old.id]);
  await writeAudit(tx, { ...actor(ctx), action: "enrollment.transfer", entityType: "enrollment", entityId: old.id, after: { toEnrollmentId: next.id, batchId: target.id, date } });
  return next;
}

export const leaveSchema = z.object({ date: isoDate.optional() });

export async function leaveEnrollment(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof leaveSchema> = {}): Promise<Enrollment> {
  assertCan(ctx, "enrollments:manage");
  const e = await requireOpen(tx, ctx, id);
  const today = await tenantToday(tx);
  const last = leaveSchema.parse(input).date ?? (e.startDate > today ? addDays(e.startDate, -1) : today);
  if (last < addDays(e.startDate, -1)) throw new BadRequestError("The last day can't be before they joined");
  const after = await updateEnrollment(tx, id, { status: "left", endDate: last, pausedOn: null });
  await endCharges(tx, actor(ctx), [id]);
  await writeAudit(tx, { ...actor(ctx), action: "enrollment.leave", entityType: "enrollment", entityId: id, after: { endDate: last } });
  return after;
}

export const planChangeSchema = z.object({ feePlanId: z.uuid().nullable() });

// Applies from the next charge; what's billed stays.
export async function setEnrollmentPlan(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof planChangeSchema>): Promise<Enrollment> {
  assertCan(ctx, "enrollments:manage");
  const { feePlanId } = planChangeSchema.parse(input);
  const e = await requireOpen(tx, ctx, id);
  if (feePlanId && !(await getPlan(tx, feePlanId))?.isActive) throw new NotFoundError("Fee plan");
  const after = await updateEnrollment(tx, id, { feePlanId });
  await writeAudit(tx, { ...actor(ctx), action: "enrollment.fee_plan", entityType: "enrollment", entityId: id, before: { feePlanId: e.feePlanId }, after: { feePlanId } });
  return after;
}

// Current and upcoming students of a batch, paused ones included.
export async function batchRoster(tx: Tx, ctx: ScopedCtx, batchId: string): Promise<RosterRow[]> {
  assertCan(ctx, "batches:read");
  if (!(await getBatch(tx, ctx.branchIds, batchId))) throw new NotFoundError("Batch");
  return rosterOf(tx, batchId, await tenantToday(tx));
}

// Not ended yet; one starting later counts from its start.
export const isCurrentEnrollment = (e: Pick<StudentEnrollment, "startDate" | "endDate">, today: string): boolean => e.endDate === null || e.endDate >= (e.startDate > today ? e.startDate : today);

export async function studentBatches(tx: Tx, ctx: ScopedCtx, studentId: string): Promise<{ current: StudentEnrollment[]; past: StudentEnrollment[] }> {
  await requireStudent(tx, ctx, studentId);
  const today = await tenantToday(tx);
  const all = await enrollmentsOfStudent(tx, studentId);
  return { current: all.filter((e) => isCurrentEnrollment(e, today)), past: all.filter((e) => !isCurrentEnrollment(e, today)).reverse() };
}

export async function batchChoices(tx: Tx, ctx: ScopedCtx): Promise<BatchView[]> {
  assertCan(ctx, "enrollments:manage");
  return listBatchViews(tx, ctx.branchIds);
}
