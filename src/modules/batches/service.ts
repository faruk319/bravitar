import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, formatDate, isIsoDate, startOfWeek, todayIn } from "@/lib/dates";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { canUseBranch, pickBranch } from "@/modules/tenancy/branch-access";
import { getBranch, getOwnTenant, listResources } from "@/modules/tenancy/repo";
import {
  type BatchRow,
  closeRulesFrom,
  coachOptions,
  createHoliday,
  createProgram,
  deleteAllRules,
  deleteHoliday,
  getBatch,
  getHoliday,
  getProgram,
  insertBatch,
  insertRules,
  listBatchRows,
  listHolidays,
  listPrograms,
  rulesFor,
  updateBatch,
  updateProgram,
} from "./repo";
import { type GridDay, normalizeTime, type Rule, rulesOn, type Slot, summarizeSchedule, validateSlots, weekGrid } from "./schedule";
import type { Batch, Holiday, Program } from "./schema";

const actor = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });

async function tenantToday(tx: Tx): Promise<string> {
  return todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata");
}

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.cause?.code ?? err.code) === "23505";
};

// ---------- programs ----------

const programName = z.string().trim().min(2, "Give the program a name").max(80);

async function findProgramByName(tx: Tx, name: string): Promise<Program | undefined> {
  const key = name.trim().toLowerCase();
  return (await listPrograms(tx)).find((p) => p.name.trim().toLowerCase() === key);
}

export async function addProgram(tx: Tx, ctx: ScopedCtx, input: { name: string; description?: string }): Promise<Program> {
  assertCan(ctx, "programs:manage");
  const name = programName.parse(input.name);
  if (await findProgramByName(tx, name)) throw new ConflictError(`A program called "${name}" already exists`);
  let program: Program;
  try {
    program = await createProgram(tx, { tenantId: ctx.tenantId, name, ...(input.description ? { description: input.description.trim() } : {}) });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`A program called "${name}" already exists`);
    throw e;
  }
  await writeAudit(tx, { ...actor(ctx), action: "program.create", entityType: "program", entityId: program.id, after: { name } });
  return program;
}

export async function editProgram(tx: Tx, ctx: ScopedCtx, id: string, input: { name?: string; isActive?: boolean }): Promise<Program> {
  assertCan(ctx, "programs:manage");
  const before = await getProgram(tx, id);
  if (!before) throw new NotFoundError("Program");
  const patch: Partial<Pick<Program, "name" | "isActive">> = {};
  if (input.name !== undefined) {
    const name = programName.parse(input.name);
    const clash = await findProgramByName(tx, name);
    if (clash && clash.id !== id) throw new ConflictError(`A program called "${name}" already exists`);
    patch.name = name;
  }
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  const after = await updateProgram(tx, id, patch);
  await writeAudit(tx, { ...actor(ctx), action: "program.update", entityType: "program", entityId: id, before: { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive } });
  return after;
}

export async function programList(tx: Tx, ctx: ScopedCtx): Promise<Program[]> {
  assertCan(ctx, "batches:read");
  return listPrograms(tx);
}

// ---------- batches ----------

const slotInput = z.object({ weekday: z.number().int(), startTime: z.string(), endTime: z.string() });

function checkSlots(raw: z.infer<typeof slotInput>[]): Slot[] {
  const slots = raw.map((s) => ({ weekday: s.weekday, startTime: normalizeTime(s.startTime) ?? "", endTime: normalizeTime(s.endTime) ?? "" }));
  const problem = validateSlots(slots);
  if (problem) throw new BadRequestError(problem);
  return slots;
}

function checkDate(value: string, label: string): string {
  if (!isIsoDate(value)) throw new BadRequestError(`${label} isn't a valid date`);
  return value;
}

async function checkCoach(tx: Tx, coachId: string, branchId: string): Promise<void> {
  const coach = (await coachOptions(tx)).find((c) => c.id === coachId);
  if (!coach) throw new NotFoundError("Coach");
  if (coach.branchIds.length && !coach.branchIds.includes(branchId)) throw new BadRequestError(`${coach.fullName} doesn't work at this branch`);
}

async function checkResource(tx: Tx, resourceId: string, branchId: string): Promise<void> {
  if (!(await listResources(tx, branchId)).some((r) => r.id === resourceId)) throw new NotFoundError("Room");
}

export const newBatchSchema = z.object({
  name: z.string().trim().min(1, "Give the batch a name").max(80),
  programId: z.uuid().optional(),
  newProgramName: z.string().trim().max(80).optional(),
  branchId: z.uuid().optional(),
  coachId: z.uuid().nullable().optional(),
  resourceId: z.uuid().nullable().optional(),
  capacity: z.number().int().min(1, "Capacity must be at least 1").max(10000).nullable().optional(),
  startDate: z.string().optional(),
  slots: z.array(slotInput).max(7),
});
export type NewBatchInput = z.input<typeof newBatchSchema>;

async function resolveProgram(tx: Tx, ctx: ScopedCtx, data: z.infer<typeof newBatchSchema>): Promise<string> {
  if (data.programId) {
    const p = await getProgram(tx, data.programId);
    if (!p || !p.isActive) throw new NotFoundError("Program");
    return p.id;
  }
  if (data.newProgramName) {
    // Typing an existing name reuses it, so the one-screen form never trips on duplicates.
    const existing = await findProgramByName(tx, data.newProgramName);
    if (existing) return (existing.isActive ? existing : await editProgram(tx, ctx, existing.id, { isActive: true })).id;
    return (await addProgram(tx, ctx, { name: data.newProgramName })).id;
  }
  throw new BadRequestError("Pick a program");
}

export async function createBatch(tx: Tx, ctx: ScopedCtx, input: NewBatchInput): Promise<Batch> {
  assertCan(ctx, "batches:manage");
  const data = newBatchSchema.parse(input);
  const slots = checkSlots(data.slots);
  const startDate = checkDate(data.startDate ?? (await tenantToday(tx)), "Start date");
  const branchId = await pickBranch(tx, ctx.branchIds, data.branchId);
  const programId = await resolveProgram(tx, ctx, data);
  if (data.coachId) await checkCoach(tx, data.coachId, branchId);
  if (data.resourceId) await checkResource(tx, data.resourceId, branchId);
  const batch = await insertBatch(tx, {
    tenantId: ctx.tenantId,
    branchId,
    programId,
    name: data.name,
    coachId: data.coachId ?? null,
    resourceId: data.resourceId ?? null,
    capacity: data.capacity ?? null,
    startDate,
  });
  await insertRules(tx, ctx.tenantId, batch.id, slots, startDate);
  await reconcileSessions(tx, { batchIds: [batch.id] });
  await writeAudit(tx, { ...actor(ctx), action: "batch.create", entityType: "batch", entityId: batch.id, after: { name: batch.name, schedule: summarizeSchedule(slots), startDate } });
  return batch;
}

export async function requireBatch(tx: Tx, ctx: ScopedCtx, id: string): Promise<Batch> {
  assertCan(ctx, "batches:read");
  const batch = await getBatch(tx, ctx.branchIds, id);
  if (!batch) throw new NotFoundError("Batch");
  return batch;
}

export const batchPatchSchema = z.object({
  name: z.string().trim().min(1, "Give the batch a name").max(80).optional(),
  programId: z.uuid().optional(),
  coachId: z.uuid().nullable().optional(),
  resourceId: z.uuid().nullable().optional(),
  capacity: z.number().int().min(1, "Capacity must be at least 1").max(10000).nullable().optional(),
});

export async function editBatch(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof batchPatchSchema>): Promise<Batch> {
  assertCan(ctx, "batches:manage");
  const before = await requireBatch(tx, ctx, id);
  const data = batchPatchSchema.parse(input);
  if (data.programId) {
    const p = await getProgram(tx, data.programId);
    if (!p || !p.isActive) throw new NotFoundError("Program");
  }
  if (data.coachId) await checkCoach(tx, data.coachId, before.branchId);
  if (data.resourceId) await checkResource(tx, data.resourceId, before.branchId);
  const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  const after = await updateBatch(tx, id, patch);
  await writeAudit(tx, { ...actor(ctx), action: "batch.update", entityType: "batch", entityId: id, before: { name: before.name, coachId: before.coachId, capacity: before.capacity }, after: patch });
  return after;
}

// docs/03 §5: a timing change only affects dates from `from` onward. Before
// the batch has started nothing has happened yet, so the rules are replaced.
export async function changeSchedule(tx: Tx, ctx: ScopedCtx, id: string, input: { slots: z.input<typeof slotInput>[]; from?: string }): Promise<{ from: string }> {
  assertCan(ctx, "batches:manage");
  const batch = await requireBatch(tx, ctx, id);
  if (batch.status === "ended") throw new ConflictError("This batch is closed. Reopen it to change the timing.");
  const slots = checkSlots(z.array(slotInput).max(7).parse(input.slots));
  const today = await tenantToday(tx);
  const rules = await rulesFor(tx, [id]);
  const before = summarizeSchedule(rulesOn(rules, batch.startDate > today ? batch.startDate : today));
  let from: string;
  if (batch.startDate > today) {
    from = batch.startDate;
    await deleteAllRules(tx, id);
  } else {
    from = checkDate(input.from ?? today, "Change date");
    if (from < today) throw new BadRequestError("A timing change can't start in the past");
    await closeRulesFrom(tx, id, from);
  }
  await insertRules(tx, ctx.tenantId, id, slots, from);
  await reconcileSessions(tx, { batchIds: [id] });
  await writeAudit(tx, { ...actor(ctx), action: "batch.schedule.set", entityType: "batch", entityId: id, before: { schedule: before }, after: { schedule: summarizeSchedule(slots), from } });
  return { from };
}

export async function closeBatch(tx: Tx, ctx: ScopedCtx, id: string, input: { endDate?: string } = {}): Promise<Batch> {
  assertCan(ctx, "batches:manage");
  const batch = await requireBatch(tx, ctx, id);
  if (batch.status === "ended") throw new ConflictError("This batch is already closed");
  const endDate = checkDate(input.endDate ?? (await tenantToday(tx)), "End date");
  if (endDate < batch.startDate) throw new BadRequestError("The end date is before the batch started");
  const after = await updateBatch(tx, id, { status: "ended", endDate });
  await reconcileSessions(tx, { batchIds: [id] });
  await writeAudit(tx, { ...actor(ctx), action: "batch.close", entityType: "batch", entityId: id, after: { endDate } });
  return after;
}

export async function reopenBatch(tx: Tx, ctx: ScopedCtx, id: string): Promise<Batch> {
  assertCan(ctx, "batches:manage");
  const batch = await requireBatch(tx, ctx, id);
  if (batch.status !== "ended") throw new ConflictError("This batch isn't closed");
  const after = await updateBatch(tx, id, { status: "active", endDate: null });
  await reconcileSessions(tx, { batchIds: [id] });
  await writeAudit(tx, { ...actor(ctx), action: "batch.reopen", entityType: "batch", entityId: id, before: { endDate: batch.endDate } });
  return after;
}

// Enrollments (and later sessions with attendance) register here; while any
// says the batch is in use it can only be closed (docs/06 Prompt 8).
export type BatchInUseCheck = (tx: Tx, batchId: string) => Promise<boolean>;
export const BATCH_IN_USE_CHECKS: BatchInUseCheck[] = [];

export async function archiveBatch(tx: Tx, ctx: ScopedCtx, id: string): Promise<void> {
  assertCan(ctx, "batches:manage");
  await requireBatch(tx, ctx, id);
  for (const inUse of BATCH_IN_USE_CHECKS) {
    if (await inUse(tx, id)) throw new ConflictError("This batch has students. Close it instead.");
  }
  await updateBatch(tx, id, { deletedAt: new Date() });
  await reconcileSessions(tx, { batchIds: [id] });
  await writeAudit(tx, { ...actor(ctx), action: "batch.archive", entityType: "batch", entityId: id });
}

export type BatchView = BatchRow & { slots: Slot[]; schedule: string; upcoming?: { from: string; schedule: string } };

function viewOf(row: BatchRow, rules: Rule[], today: string): BatchView {
  const ref = row.endDate && row.endDate < today ? row.endDate : row.startDate > today ? row.startDate : today;
  const slots = rulesOn(rules, ref).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime }));
  const next = rules.map((r) => r.effectiveFrom).filter((d) => d > ref).sort()[0];
  const view: BatchView = { ...row, slots, schedule: summarizeSchedule(slots) };
  if (next) view.upcoming = { from: next, schedule: summarizeSchedule(rulesOn(rules, next)) };
  return view;
}

export async function batchViews(tx: Tx, ctx: ScopedCtx, opts: { includeEnded?: boolean; branchId?: string; id?: string } = {}): Promise<BatchView[]> {
  assertCan(ctx, "batches:read");
  const rows = await listBatchRows(tx, ctx.branchIds, opts);
  const rules = await rulesFor(tx, rows.map((r) => r.id));
  const today = await tenantToday(tx);
  return rows.map((r) => viewOf(r, rules.filter((x) => x.batchId === r.id), today));
}

export async function batchDetail(tx: Tx, ctx: ScopedCtx, id: string): Promise<BatchView> {
  const [view] = await batchViews(tx, ctx, { id, includeEnded: true });
  if (!view) throw new NotFoundError("Batch");
  return view;
}

export type WeekCalendar = { weekStart: string; today: string; days: GridDay<string>[]; batches: Record<string, BatchRow> };

export async function weekCalendar(tx: Tx, ctx: ScopedCtx, opts: { date?: string; branchId?: string } = {}): Promise<WeekCalendar> {
  assertCan(ctx, "batches:read");
  if (opts.branchId && !canUseBranch(ctx.branchIds, opts.branchId)) throw new NotFoundError("Branch");
  const today = await tenantToday(tx);
  const weekStart = startOfWeek(opts.date && isIsoDate(opts.date) ? opts.date : today);
  const rows = await listBatchRows(tx, ctx.branchIds, { includeEnded: true, ...(opts.branchId ? { branchId: opts.branchId } : {}) });
  const rules = await rulesFor(tx, rows.map((r) => r.id));
  const hols = await listHolidays(tx, opts.branchId ? [opts.branchId] : ctx.branchIds, { from: weekStart, to: addDays(weekStart, 6) });
  const days = weekGrid(
    rows.map((r) => ({ key: r.id, branchId: r.branchId, rules: rules.filter((x) => x.batchId === r.id), startDate: r.startDate, endDate: r.endDate })),
    weekStart,
    hols.map((h) => ({ date: h.date, name: h.name, branchId: h.branchId })),
  );
  return { weekStart, today, days, batches: Object.fromEntries(rows.map((r) => [r.id, r])) };
}

export async function coachChoices(tx: Tx, ctx: ScopedCtx) {
  assertCan(ctx, "batches:read");
  return coachOptions(tx);
}

// ---------- holidays ----------

export const holidaySchema = z.object({
  date: z.string(),
  name: z.string().trim().min(2, "Give the holiday a name").max(80),
  branchId: z.uuid().nullable().optional(),
});

export async function addHoliday(tx: Tx, ctx: ScopedCtx, input: z.input<typeof holidaySchema>): Promise<Holiday> {
  assertCan(ctx, "batches:manage");
  const data = holidaySchema.parse(input);
  const date = checkDate(data.date, "Date");
  const branchId = data.branchId ?? null;
  if (branchId === null && ctx.branchIds.length) throw new BadRequestError("Pick your branch");
  if (branchId && (!canUseBranch(ctx.branchIds, branchId) || !(await getBranch(tx, branchId)))) throw new NotFoundError("Branch");
  const taken = (await listHolidays(tx, [], { from: date, to: date })).some((h) => h.branchId === branchId);
  if (taken) throw new ConflictError(`There's already a holiday on ${formatDate(date)}`);
  let holiday: Holiday;
  try {
    holiday = await createHoliday(tx, { tenantId: ctx.tenantId, branchId, date, name: data.name });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`There's already a holiday on ${formatDate(date)}`);
    throw e;
  }
  await writeAudit(tx, { ...actor(ctx), action: "holiday.create", entityType: "holiday", entityId: holiday.id, after: { date, name: data.name, branchId } });
  await reconcileSessions(tx);
  return holiday;
}

export async function removeHoliday(tx: Tx, ctx: ScopedCtx, id: string): Promise<void> {
  assertCan(ctx, "batches:manage");
  const h = await getHoliday(tx, id);
  const allowed = h && (h.branchId === null ? !ctx.branchIds.length : canUseBranch(ctx.branchIds, h.branchId));
  if (!h || !allowed) throw new NotFoundError("Holiday");
  await deleteHoliday(tx, id);
  await reconcileSessions(tx);
  await writeAudit(tx, { ...actor(ctx), action: "holiday.delete", entityType: "holiday", entityId: id, before: { date: h.date, name: h.name, branchId: h.branchId } });
}

export async function holidayList(tx: Tx, ctx: ScopedCtx, opts: { from?: string } = {}): Promise<Holiday[]> {
  assertCan(ctx, "batches:read");
  return listHolidays(tx, ctx.branchIds, opts.from ? { from: opts.from } : {});
}
