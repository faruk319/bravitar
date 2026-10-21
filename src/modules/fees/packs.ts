import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, isIsoDate } from "@/lib/dates";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { attendance } from "@/modules/attendance/schema";
import { currentEnrollmentsOf, getEnrollment } from "@/modules/enrollments/repo";
import { enrollments } from "@/modules/enrollments/schema";
import { sessions } from "@/modules/sessions/schema";
import type { Payer } from "@/modules/students/payer";
import { students } from "@/modules/students/schema";
import { tenantToday } from "@/modules/tenancy/repo";
import type { Actor } from "./invoicing";
import { type FeePlan, type Invoice, invoices, type SessionPack, sessionPacks } from "./schema";
import { addCharge, issueDrafts } from "./service";

// Prepaid session packs (finance spec, addendum 2026-10-21).

// A plan's pack terms, or null when it isn't a session pack.
export function packTerms(plan: Pick<FeePlan, "kind" | "metadata"> | null | undefined): { sessions: number; validDays: number } | null {
  const { sessions: n, valid_days: days } = plan?.metadata ?? {};
  return plan?.kind === "package" && n && days ? { sessions: n, validDays: days } : null;
}

export async function insertPack(tx: Tx, row: Omit<typeof sessionPacks.$inferInsert, "id">): Promise<SessionPack> {
  const [pack] = await tx.insert(sessionPacks).values({ id: uuidv7(), ...row }).returning();
  if (!pack) throw new Error("session pack insert returned no row");
  return pack;
}

// For callers that hold lockInvoicing and the payer's lock and check the payer: the pack's invoice is
// issued with the advance left alone (the payment pays it in full), and the pack starts today.
export async function sellPack(tx: Tx, by: Actor, input: { enrollmentId: string; payer: Payer }, now: Date): Promise<{ pack: SessionPack; invoice: Invoice }> {
  const e = await getEnrollment(tx, input.enrollmentId);
  const placed = e ? (await currentEnrollmentsOf(tx, [e.studentId])).find((p) => p.e.id === e.id) : undefined;
  if (!placed) throw new NotFoundError("Enrollment");
  const terms = packTerms(placed.plan);
  if (!placed.plan || !terms) throw new BadRequestError("This program isn't on a session pack");
  const today = await tenantToday(tx, now);
  const line = { kind: "tuition" as const, description: `${placed.plan.name} · ${terms.sessions} sessions`, amountPaise: placed.plan.amountPaise, enrollmentId: placed.e.id, taxRateBp: placed.plan.taxRateBp };
  const draft = await addCharge(tx, by, { studentId: placed.e.studentId, branchId: placed.branchId, payer: input.payer, lines: [line], dueDate: today, via: "collect" }, { now });
  const [invoice] = await issueDrafts(tx, by, [draft], { now, applyAdvance: false });
  if (!invoice) throw new ConflictError("This payer has no name on record");
  const pack = await insertPack(tx, {
    tenantId: by.tenantId,
    enrollmentId: placed.e.id,
    studentId: placed.e.studentId,
    invoiceId: invoice.id,
    sessions: terms.sessions,
    validFrom: today,
    validUntil: addDays(today, terms.validDays - 1),
    createdBy: by.actorType === "staff" ? (by.actorId ?? null) : null,
  });
  await writeAudit(tx, { ...by, action: "session_pack.create", entityType: "session_pack", entityId: pack.id, after: { enrollmentId: pack.enrollmentId, invoiceId: invoice.id, sessions: pack.sessions, validFrom: pack.validFrom, validUntil: pack.validUntil } });
  return { pack, invoice };
}

export type PackBalance = { left: number; until: string | null };

// Sessions left on `day` for each enrollment that has a pack: Present or Late marks on the enrollment's batch,
// each used by the oldest pack whose window holds it. until: the end of the pack the next session uses.
export async function packBalance(tx: Tx, enrollmentIds: string[], day: string): Promise<Map<string, PackBalance>> {
  const out = new Map<string, PackBalance>();
  if (!enrollmentIds.length) return out;
  const packs = await tx
    .select({ p: sessionPacks })
    .from(sessionPacks)
    .innerJoin(invoices, eq(invoices.id, sessionPacks.invoiceId))
    .where(and(inArray(sessionPacks.enrollmentId, enrollmentIds), ne(invoices.status, "void")))
    .orderBy(asc(sessionPacks.validFrom), asc(sessionPacks.createdAt), asc(sessionPacks.id));
  if (!packs.length) return out;
  const marks = await tx
    .select({ enrollmentId: enrollments.id, day: sessions.sessionDate })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .innerJoin(enrollments, and(eq(enrollments.batchId, sessions.batchId), eq(enrollments.studentId, attendance.studentId)))
    .where(and(inArray(enrollments.id, [...new Set(packs.map((r) => r.p.enrollmentId))]), inArray(attendance.status, ["present", "late"])))
    .orderBy(asc(sessions.sessionDate), asc(sessions.startsAt));
  const used = new Map<string, number>();
  for (const m of marks) {
    const pack = packs.find(({ p }) => p.enrollmentId === m.enrollmentId && p.validFrom <= m.day && m.day <= p.validUntil && (used.get(p.id) ?? 0) < p.sessions);
    if (pack) used.set(pack.p.id, (used.get(pack.p.id) ?? 0) + 1);
  }
  for (const { p } of packs) {
    const was = out.get(p.enrollmentId) ?? { left: 0, until: null };
    const left = p.validFrom <= day && day <= p.validUntil ? p.sessions - (used.get(p.id) ?? 0) : 0;
    out.set(p.enrollmentId, { left: was.left + left, until: was.until ?? (left > 0 ? p.validUntil : null) });
  }
  return out;
}

export const extendSchema = z.object({
  until: z.string().refine(isIsoDate, "Pick a date"),
  reason: z.string().trim().min(3, "Add a reason").max(200),
});

// A later expiry, with a reason. Unused sessions then last until the new date.
export async function extendPack(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof extendSchema>): Promise<SessionPack> {
  assertCan(ctx, "invoices:manage");
  const data = extendSchema.parse(input);
  const [row] = await tx.select({ p: sessionPacks, branchId: students.branchId }).from(sessionPacks).innerJoin(students, eq(students.id, sessionPacks.studentId)).where(eq(sessionPacks.id, id));
  if (!row || (ctx.branchIds.length && !ctx.branchIds.includes(row.branchId))) throw new NotFoundError("Session pack");
  if (data.until <= row.p.validUntil) throw new BadRequestError("Pick a later date");
  const [after] = await tx.update(sessionPacks).set({ validUntil: data.until, extendedReason: data.reason }).where(eq(sessionPacks.id, id)).returning();
  if (!after) throw new NotFoundError("Session pack");
  await writeAudit(tx, { actorType: "staff", actorId: ctx.staffId, tenantId: ctx.tenantId, action: "session_pack.extend", entityType: "session_pack", entityId: id, before: { validUntil: row.p.validUntil }, after: { validUntil: after.validUntil, reason: data.reason } });
  return after;
}
