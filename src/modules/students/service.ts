import { z } from "zod";
import { type AccessContext, assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { phoneSchema } from "@/lib/phone";
import { isMinor } from "@/lib/students/age";
import { endForStudent, hasEnrollments, pauseForStudent, resumeForStudent } from "@/modules/enrollments/repo";
import { endCharges } from "@/modules/fees/invoicing";
import { pickBranch } from "@/modules/tenancy/branch-access";
import { assertStudentRoom } from "@/modules/platform/limits";
import { getOwnTenant, tenantToday } from "@/modules/tenancy/repo";
import { nextStudentCode, STUDENT_CODE_RE } from "./codes";
import {
  createGuardian,
  createHousehold,
  currentConsents,
  findGuardianByPhone,
  getGuardian,
  getHousehold,
  getStudent,
  guardiansOfHousehold,
  guardiansOfStudent,
  insertStudent,
  linkGuardian,
  recordConsent,
  type Scope,
  studentsOfHousehold,
  updateGuardian,
  updateStudent,
} from "./repo";
import { type ConsentKind, type Guardian, type Household, LEFT_REASONS, RELATIONS, type Student, STUDENT_STATUSES, type StudentMetadata, type StudentStatus } from "./schema";

export type StudentCtx = ScopedCtx;

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
  consents: z.object({ dataProcessing: z.boolean(), photo: z.boolean().optional(), whatsapp: z.boolean().optional() }), // whatsapp: the guardian's opt-in
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
  const branchId = await pickBranch(tx, ctx.branchIds, data.branchId);
  await assertStudentRoom(tx, branchId);

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
  // Ticking it opts the guardian in; leaving it blank never takes an opt-in away.
  if (data.consents.whatsapp && !guardian.whatsappOptin) guardian = await updateGuardian(tx, guardian.id, { whatsappOptin: true, whatsappOptinAt: new Date() });

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
    if (isUniqueViolation(e)) throw new ConflictError("That code is already used");
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
  if (s.status === "left") await assertStudentRoom(tx, s.branchId); // counts again
  const today = await tenantToday(tx);
  const patch: Partial<typeof s> = { status: data.status };
  if (data.status === "left") {
    if (!data.reason) throw new BadRequestError("Pick a reason");
    if (data.reason === "other" && !data.note) throw new BadRequestError("Add a short note for 'Other'");
    Object.assign(patch, { leftOn: today, leftReason: data.reason, leftNote: data.note ?? null });
  } else if (s.status === "left") {
    Object.assign(patch, { leftOn: null, leftReason: null, leftNote: null });
  }
  const after = await updateStudent(tx, id, patch);
  // Their batches follow (agreed 2026-09-23).
  const enrollmentIds =
    data.status === "left" ? await endForStudent(tx, id, today) : data.status === "paused" ? await pauseForStudent(tx, id, today) : s.status === "paused" ? await resumeForStudent(tx, id) : [];
  if (data.status === "left") await endCharges(tx, actor(ctx), enrollmentIds);
  await writeAudit(tx, { ...actor(ctx), action: "student.status.set", entityType: "student", entityId: id, before: { status: s.status }, after: { status: data.status, reason: data.reason ?? null, enrollmentIds } });
  return after;
}

// docs/03 §10 (agreed 2026-09-25): automated WhatsApp only after the guardian says yes.
export async function setGuardianWhatsapp(tx: Tx, ctx: StudentCtx, guardianId: string, on: boolean): Promise<Guardian> {
  assertCan(ctx, "students:update");
  const g = await getGuardian(tx, guardianId);
  const kids = g ? await studentsOfHousehold(tx, g.householdId) : [];
  if (!g || !kids.some((k) => !ctx.branchIds.length || ctx.branchIds.includes(k.branchId))) throw new NotFoundError("Guardian");
  if (g.whatsappOptin === on) return g;
  const after = await updateGuardian(tx, guardianId, { whatsappOptin: on, whatsappOptinAt: on ? new Date() : null });
  await writeAudit(tx, { ...actor(ctx), action: on ? "guardian.whatsapp_optin" : "guardian.whatsapp_optout", entityType: "guardian", entityId: guardianId });
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

// Soft delete (CLAUDE.md rule 7), refused once there is history (docs/03 §3).
// Attendance and invoices add their checks here when they land.
export async function archiveStudent(tx: Tx, ctx: StudentCtx, id: string): Promise<void> {
  assertCan(ctx, "students:update");
  await requireStudent(tx, ctx, id);
  if (await hasEnrollments(tx, { studentId: id })) throw new ConflictError("This student has been in a batch and can't be removed. Mark them as left instead.");
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
