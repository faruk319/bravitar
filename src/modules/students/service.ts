import { z } from "zod";
import { type AccessContext, assertCan } from "@/lib/auth/can";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { phoneSchema } from "@/lib/phone";
import { isMinor } from "@/lib/students/age";
import { getBranch, getDefaultBranch, getOwnTenant } from "@/modules/tenancy/repo";
import { nextStudentCode, STUDENT_CODE_RE } from "./codes";
import {
  createGuardian,
  createHousehold,
  currentConsents,
  findGuardianByPhone,
  getHousehold,
  getStudent,
  guardiansOfHousehold,
  guardiansOfStudent,
  insertStudent,
  linkGuardian,
  recordConsent,
  type Scope,
  studentsOfHousehold,
  updateStudent,
} from "./repo";
import { type ConsentKind, type Guardian, type Household, LEFT_REASONS, RELATIONS, type Student, STUDENT_STATUSES, type StudentMetadata, type StudentStatus } from "./schema";

export type StudentCtx = AccessContext & { branchIds: string[]; ip?: string };

const scopeOf = (ctx: StudentCtx): Scope => ({ branchIds: ctx.branchIds });
const actor = (ctx: AccessContext) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

export const newStudentSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: isoDate.optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  branchId: z.uuid().optional(),
  joinedOn: isoDate.optional(),
  programInterest: z.string().trim().max(120).optional(),
  // Either an adult with their own phone, a guardian, or both.
  adultPhone: phoneSchema.optional(),
  guardian: z
    .object({
      fullName: z.string().trim().min(2).max(120),
      phone: phoneSchema,
      relation: z.enum(RELATIONS.filter((r) => r !== "self") as unknown as ["father", "mother", "other"]),
      email: z.email().trim().toLowerCase().optional(),
    })
    .optional(),
  householdId: z.uuid().optional(), // link to an existing family instead of creating one
  consents: z.object({ dataProcessing: z.boolean(), photo: z.boolean().optional() }),
});
export type NewStudentInput = z.input<typeof newStudentSchema>;

export type HouseholdSuggestion = { householdId: string; householdName: string; guardianName: string; students: string[] };

// 409 carrying the family to link to (docs/03 §3 "offer link to existing family").
export class DuplicateGuardianError extends ConflictError {
  constructor(readonly suggestion: HouseholdSuggestion) {
    super(`This phone number already belongs to ${suggestion.guardianName}`, suggestion);
  }
}

export async function lookupGuardian(tx: Tx, phone: string): Promise<HouseholdSuggestion | undefined> {
  const g = await findGuardianByPhone(tx, phone);
  if (!g) return undefined;
  const [household, kids] = await Promise.all([getHousehold(tx, g.householdId), studentsOfHousehold(tx, g.householdId)]);
  return { householdId: g.householdId, householdName: household?.name ?? "", guardianName: g.fullName, students: kids.map((s) => s.fullName) };
}

function householdNameFor(guardianName: string): string {
  const last = guardianName.trim().split(/\s+/).at(-1) ?? guardianName;
  return `${last} family`;
}

async function resolveBranch(tx: Tx, ctx: StudentCtx, wanted: string | undefined): Promise<string> {
  const allowed = ctx.branchIds;
  if (wanted) {
    if (allowed.length && !allowed.includes(wanted)) throw new NotFoundError("Branch");
    if (!(await getBranch(tx, wanted))) throw new NotFoundError("Branch");
    return wanted;
  }
  if (allowed.length === 1) return allowed[0] ?? "";
  const def = await getDefaultBranch(tx);
  if (!def || (allowed.length && !allowed.includes(def.id))) throw new BadRequestError("Pick a branch");
  return def.id;
}

function yearIn(timezone: string): number {
  return Number(new Intl.DateTimeFormat("en-IN", { timeZone: timezone, year: "numeric" }).format(new Date()));
}

export type CreatedStudent = { student: Student; household: Household; guardian: Guardian };

// Import records consent as declared on paper and tags the audit row.
export type CreateStudentOptions = { consentMethod?: "staff_recorded" | "paper"; source?: "form" | "csv_import" };

export async function createStudent(tx: Tx, ctx: StudentCtx, input: NewStudentInput, opts: CreateStudentOptions = {}): Promise<CreatedStudent> {
  assertCan(ctx, "students:create");
  const data = newStudentSchema.parse(input);
  const minor = isMinor(data.dateOfBirth);
  if (!data.consents.dataProcessing) throw new BadRequestError("Data-processing consent is required");
  if (minor && !data.guardian) throw new BadRequestError("A minor needs a parent or guardian");
  if (!data.guardian && !data.adultPhone) throw new BadRequestError("Add a guardian, or a phone number for an adult student");

  const contactPhone = data.guardian?.phone ?? data.adultPhone ?? "";
  const branchId = await resolveBranch(tx, ctx, data.branchId);

  // Household and guardian: reuse the family when the phone is known.
  let household: Household;
  let guardian: Guardian;
  const existing = await findGuardianByPhone(tx, contactPhone);
  if (data.householdId) {
    const h = await getHousehold(tx, data.householdId);
    if (!h) throw new NotFoundError("Family");
    if (existing && existing.householdId !== h.id) throw new ConflictError("This phone number belongs to another family");
    household = h;
    guardian =
      existing ??
      (await createGuardian(tx, {
        tenantId: ctx.tenantId,
        householdId: h.id,
        fullName: data.guardian?.fullName ?? data.fullName,
        phone: contactPhone,
        isPrimary: (await guardiansOfHousehold(tx, h.id)).length === 0,
        ...(data.guardian?.email ? { email: data.guardian.email } : {}),
      }));
  } else {
    if (existing) {
      const suggestion = await lookupGuardian(tx, contactPhone);
      if (suggestion) throw new DuplicateGuardianError(suggestion);
    }
    household = await createHousehold(tx, { tenantId: ctx.tenantId, name: data.guardian ? householdNameFor(data.guardian.fullName) : data.fullName });
    guardian = await createGuardian(tx, {
      tenantId: ctx.tenantId,
      householdId: household.id,
      fullName: data.guardian?.fullName ?? data.fullName,
      phone: contactPhone,
      isPrimary: true,
      ...(data.guardian?.email ? { email: data.guardian.email } : {}),
    });
  }

  const tenant = await getOwnTenant(tx);
  if (!tenant) throw new NotFoundError("Tenant");
  const code = await nextStudentCode(tx, ctx.tenantId, tenant.codePrefix, yearIn(tenant.timezone));

  const student = await insertStudent(tx, {
    tenantId: ctx.tenantId,
    branchId,
    householdId: household.id,
    code,
    fullName: data.fullName,
    dateOfBirth: data.dateOfBirth ?? null,
    gender: data.gender ?? null,
    phone: data.adultPhone ?? null,
    joinedOn: data.joinedOn ?? new Date().toISOString().slice(0, 10),
    metadata: data.programInterest ? { programInterest: data.programInterest } : {},
  });
  await linkGuardian(tx, ctx.tenantId, student.id, guardian.id, data.guardian ? data.guardian.relation : "self");

  const consent = { tenantId: ctx.tenantId, studentId: student.id, guardianId: guardian.id, method: opts.consentMethod ?? "staff_recorded", ...(ctx.ip ? { grantedIp: ctx.ip } : {}) };
  await recordConsent(tx, { ...consent, kind: "data_processing", granted: true });
  if (data.consents.photo !== undefined) await recordConsent(tx, { ...consent, kind: "photo", granted: data.consents.photo });

  await writeAudit(tx, { ...actor(ctx), action: "student.create", entityType: "student", entityId: student.id, after: { code, householdId: household.id, source: opts.source ?? "form" } });
  return { student, household, guardian };
}

export async function requireStudent(tx: Tx, ctx: StudentCtx, id: string): Promise<Student> {
  assertCan(ctx, "students:read");
  const s = await getStudent(tx, scopeOf(ctx), id);
  if (!s) throw new NotFoundError("Student");
  return s;
}

export const studentPatchSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  dateOfBirth: isoDate.nullable().optional(),
  gender: z.enum(["male", "female", "other"]).nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  programInterest: z.string().trim().max(120).nullable().optional(),
});

export async function updateStudentDetails(tx: Tx, ctx: StudentCtx, id: string, input: z.input<typeof studentPatchSchema>): Promise<Student> {
  assertCan(ctx, "students:update");
  const before = await requireStudent(tx, ctx, id);
  const data = studentPatchSchema.parse(input);
  const { programInterest, ...cols } = data;
  const metadata: StudentMetadata = { ...before.metadata };
  if (programInterest === null) delete metadata.programInterest;
  else if (programInterest !== undefined) metadata.programInterest = programInterest;
  // Drop undefined keys: with exactOptionalPropertyTypes they are not "absent".
  const patch = Object.fromEntries(Object.entries({ ...cols, metadata }).filter(([, v]) => v !== undefined)) as Parameters<typeof updateStudent>[2];
  const after = await updateStudent(tx, id, patch);
  await writeAudit(tx, { ...actor(ctx), action: "student.update", entityType: "student", entityId: id, before: { fullName: before.fullName }, after: { fullName: after.fullName } });
  return after;
}

// docs/03 §3: editable once, then locked.
export async function setStudentCode(tx: Tx, ctx: StudentCtx, id: string, code: string): Promise<Student> {
  assertCan(ctx, "students:update");
  const s = await requireStudent(tx, ctx, id);
  if (s.codeEditedAt) throw new ConflictError("The code has already been changed once and is now locked");
  const next = code.trim().toUpperCase();
  if (!STUDENT_CODE_RE.test(next)) throw new BadRequestError("Code must look like SKA/2026/0001");
  let after: Student;
  try {
    after = await updateStudent(tx, id, { code: next, codeEditedAt: new Date() });
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } }).cause?.code === "23505") throw new ConflictError("That code is already used");
    throw e;
  }
  await writeAudit(tx, { ...actor(ctx), action: "student.code.set", entityType: "student", entityId: id, before: { code: s.code }, after: { code: next } });
  return after;
}

const TRANSITIONS: Record<StudentStatus, StudentStatus[]> = {
  active: ["paused", "left"],
  paused: ["active", "left"],
  left: ["active"],
  prospect: ["active"],
};

export const statusChangeSchema = z.object({
  status: z.enum(STUDENT_STATUSES),
  reason: z.enum(LEFT_REASONS).optional(),
  note: z.string().trim().max(300).optional(),
});

export async function setStudentStatus(tx: Tx, ctx: StudentCtx, id: string, input: z.input<typeof statusChangeSchema>): Promise<Student> {
  assertCan(ctx, "students:update");
  const s = await requireStudent(tx, ctx, id);
  const data = statusChangeSchema.parse(input);
  if (!TRANSITIONS[s.status].includes(data.status)) throw new BadRequestError(`Can't go from ${s.status} to ${data.status}`);
  const patch: Partial<typeof s> = { status: data.status };
  if (data.status === "left") {
    if (!data.reason) throw new BadRequestError("Pick a reason");
    if (data.reason === "other" && !data.note) throw new BadRequestError("Add a short note for 'Other'");
    Object.assign(patch, { leftOn: new Date().toISOString().slice(0, 10), leftReason: data.reason, leftNote: data.note ?? null });
  } else if (s.status === "left") {
    Object.assign(patch, { leftOn: null, leftReason: null, leftNote: null });
  }
  const after = await updateStudent(tx, id, patch);
  await writeAudit(tx, { ...actor(ctx), action: "student.status.set", entityType: "student", entityId: id, before: { status: s.status }, after: { status: data.status, reason: data.reason ?? null } });
  return after;
}

export async function setConsent(tx: Tx, ctx: StudentCtx, id: string, kind: ConsentKind, granted: boolean): Promise<void> {
  assertCan(ctx, "students:update");
  await requireStudent(tx, ctx, id);
  if (kind === "data_processing" && !granted) throw new BadRequestError("Data-processing consent cannot be withdrawn while the student is enrolled; mark them as left instead");
  const primary = (await guardiansOfStudent(tx, id))[0];
  await recordConsent(tx, { tenantId: ctx.tenantId, studentId: id, guardianId: primary?.id ?? null, kind, granted, method: "staff_recorded", ...(ctx.ip ? { grantedIp: ctx.ip } : {}) });
  await writeAudit(tx, { ...actor(ctx), action: granted ? "consent.grant" : "consent.revoke", entityType: "student", entityId: id, after: { kind } });
}

// Slices that create history (attendance, invoices, payments) register a
// check here; while any returns true the student can only be marked as left.
export type HistoryCheck = (tx: Tx, studentId: string) => Promise<boolean>;
export const HISTORY_CHECKS: HistoryCheck[] = [];

export async function studentHasHistory(tx: Tx, studentId: string): Promise<boolean> {
  for (const check of HISTORY_CHECKS) if (await check(tx, studentId)) return true;
  return false;
}

// Soft delete (CLAUDE.md rule 7), refused once there is history (docs/03 §3).
export async function archiveStudent(tx: Tx, ctx: StudentCtx, id: string): Promise<void> {
  assertCan(ctx, "students:update");
  await requireStudent(tx, ctx, id);
  if (await studentHasHistory(tx, id)) throw new ConflictError("This student has attendance or fee history and cannot be removed. Mark them as left instead.");
  await updateStudent(tx, id, { deletedAt: new Date() });
  await writeAudit(tx, { ...actor(ctx), action: "student.archive", entityType: "student", entityId: id });
}

export async function studentOverview(tx: Tx, ctx: StudentCtx, id: string) {
  const student = await requireStudent(tx, ctx, id);
  const [household, guardians, siblings, consents] = await Promise.all([
    getHousehold(tx, student.householdId),
    guardiansOfStudent(tx, id),
    studentsOfHousehold(tx, student.householdId),
    currentConsents(tx, id),
  ]);
  return { student, household, guardians, siblings: siblings.filter((s) => s.id !== id), consents };
}
