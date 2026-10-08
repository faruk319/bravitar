import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { phoneSchema } from "@/lib/phone";
import { FAMILY_RELATIONS } from "./relations";
import { createGuardian, findGuardianByPhone, guardiansOfMembers, guardiansOfStudent, moveManager, removeFamilyLink, upsertFamilyLink } from "./repo";
import type { Guardian } from "./schema";
import { describeGuardian, KnownGuardianError, requireStudent, type StudentCtx } from "./service";

// A student's family members (agreed 2026-10-03): people in the student's
// family with access to them, one of them the manager. Staff who edit
// students make every change, and each is audited.

const familyMemberSchema = z.object({
  fullName: z.string().trim().min(2, "Give their name").max(120),
  phone: phoneSchema,
  relation: z.enum(FAMILY_RELATIONS),
  linkGuardianId: z.uuid().optional(), // staff's answer when the number is a known guardian: the same person, link them
});

const actor = (ctx: StudentCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });

// Someone already linked to this member, even once removed, is linked (again). A number that is
// another known guardian is asked, never refused or linked on its own: staff know if it is the same person.
// Linking gives them access to this member too; they stay linked to the others.
export async function addFamilyMember(tx: Tx, ctx: StudentCtx, studentId: string, input: z.input<typeof familyMemberSchema>): Promise<Guardian> {
  assertCan(ctx, "students:update");
  await requireStudent(tx, ctx, studentId);
  const d = familyMemberSchema.parse(input);
  const existing = await findGuardianByPhone(tx, d.phone);
  if (existing && !(await guardiansOfMembers(tx, [studentId], { includeRemoved: true })).some((m) => m.id === existing.id)) {
    const known = await describeGuardian(tx, ctx, existing, studentId);
    // Staff can only say "the same person" about someone they can see.
    if (d.linkGuardianId !== existing.id || !known.guardianId) throw new KnownGuardianError(known);
  }
  const guardian =
    existing ??
    (await createGuardian(tx, { tenantId: ctx.tenantId, fullName: d.fullName, phone: d.phone }).catch((e: unknown) => {
      if (isUniqueViolation(e)) throw new ConflictError("This number is already used here");
      throw e;
    }));
  await upsertFamilyLink(tx, { tenantId: ctx.tenantId, studentId, guardianId: guardian.id, relation: d.relation });
  await writeAudit(tx, { ...actor(ctx), action: "family.add", entityType: "student", entityId: studentId, after: { guardianId: guardian.id, relation: d.relation, newPerson: !existing } });
  return guardian;
}

// The manager sees the whole portal and pays online.
export async function setManager(tx: Tx, ctx: StudentCtx, studentId: string, guardianId: string): Promise<void> {
  assertCan(ctx, "students:update");
  await requireStudent(tx, ctx, studentId);
  const family = await guardiansOfStudent(tx, studentId);
  if (!family.some((g) => g.id === guardianId)) throw new NotFoundError("Family member");
  const before = family.find((g) => g.isManager)?.id ?? null;
  if (before === guardianId) return;
  await moveManager(tx, studentId, guardianId);
  await writeAudit(tx, { ...actor(ctx), action: "family.manager.set", entityType: "student", entityId: studentId, before: { guardianId: before }, after: { guardianId } });
}

// Their access to this student ends; they stay in the family's records.
export async function removeFamilyMember(tx: Tx, ctx: StudentCtx, studentId: string, guardianId: string, now = new Date()): Promise<void> {
  assertCan(ctx, "students:update");
  await requireStudent(tx, ctx, studentId);
  const member = (await guardiansOfStudent(tx, studentId)).find((g) => g.id === guardianId);
  if (!member) throw new NotFoundError("Family member");
  if (member.isManager) throw new ConflictError("Make someone else the manager first");
  if (member.isPrimary) throw new ConflictError("The family's main contact gets its messages, so they stay");
  await removeFamilyLink(tx, studentId, guardianId, now);
  await writeAudit(tx, { ...actor(ctx), action: "family.remove", entityType: "student", entityId: studentId, before: { guardianId, relation: member.relation } });
}
