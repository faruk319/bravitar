import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { isIsoDate } from "@/lib/dates";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { getBatch } from "@/modules/batches/repo";
import { enroll } from "@/modules/enrollments/service";
import { createStudent } from "@/modules/students/service";
import { tenantToday } from "@/modules/tenancy/repo";
import { OPEN_STATUSES } from "./lists";
import { cancelOpenTrials, getEnquiry, trialsOf } from "./repo";
import { setStatus } from "./service";

// docs/06 Prompt 18: one step from enquiry to student, family, guardian and
// enrollment, with the phone carried forward. docs/03 §4: joined on the
// conversion date, linked back by converted_student_id, never deleted.

const isoDate = z.string().refine(isIsoDate, "use YYYY-MM-DD");

export const convertSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(), // a corrected spelling; the enquiry's name otherwise
  adult: z.boolean().default(false), // their own contact: the phone is theirs
  guardian: z.object({ fullName: z.string().trim().min(2, "Add the parent's name").max(120), relation: z.enum(["father", "mother", "other"]) }).optional(),
  dateOfBirth: isoDate.optional(),
  householdId: z.uuid().optional(), // the family already on this phone
  batchId: z.uuid("Pick a batch"),
  startDate: isoDate.optional(),
  consents: z.object({ dataProcessing: z.boolean(), photo: z.boolean().optional(), whatsapp: z.boolean().optional() }),
});

// The batch of the trial they came to, else the enquiry's own.
export async function suggestedBatch(tx: Tx, enquiryId: string, fallback: string | null): Promise<string | null> {
  const attended = (await trialsOf(tx, enquiryId)).find((t) => !t.cancelledAt && (t.mark === "present" || t.mark === "late"));
  return attended?.batchId ?? fallback;
}

export async function convertEnquiry(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof convertSchema>): Promise<{ studentId: string; enrollmentId: string }> {
  assertCan(ctx, "enquiries:convert");
  const d = convertSchema.parse(input);
  const e = await getEnquiry(tx, ctx.branchIds, id);
  if (!e) throw new NotFoundError("Enquiry");
  if (!OPEN_STATUSES.includes(e.status)) throw new ConflictError(e.status === "won" ? "Already joined" : "Reopen it first");
  if (!d.adult && !d.guardian) throw new BadRequestError("Add the parent's name");
  if (d.adult && !d.dateOfBirth) throw new BadRequestError("Add the date of birth for an adult");
  const batch = await getBatch(tx, ctx.branchIds, d.batchId);
  if (!batch) throw new NotFoundError("Batch");
  const today = await tenantToday(tx);
  const { student } = await createStudent(tx, ctx, {
    fullName: d.fullName ?? e.name,
    branchId: batch.branchId,
    joinedOn: today,
    ...(d.dateOfBirth ? { dateOfBirth: d.dateOfBirth } : {}),
    ...(d.guardian && !d.adult ? { guardian: { ...d.guardian, phone: e.phone } } : { adultPhone: e.phone }),
    ...(d.householdId ? { householdId: d.householdId } : {}),
    consents: d.consents,
  });
  const enrollment = await enroll(tx, ctx, { studentId: student.id, batchId: batch.id, startDate: d.startDate ?? today });
  await setStatus(tx, ctx, e, "won", { convertedStudentId: student.id, nextFollowUp: null }, { note: `Joined ${batch.name}` });
  await cancelOpenTrials(tx, e.id, new Date()); // now on the roster as a student
  await writeAudit(tx, { actorType: "staff", actorId: ctx.staffId, tenantId: ctx.tenantId, action: "enquiry.convert", entityType: "enquiry", entityId: e.id, after: { studentId: student.id, enrollmentId: enrollment.id } });
  return { studentId: student.id, enrollmentId: enrollment.id };
}
