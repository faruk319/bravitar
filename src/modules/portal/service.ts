import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, monthEnd, todayIn } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import type { Paise } from "@/lib/money/paise";
import { studentClasses } from "@/modules/attendance/repo";
import type { Mark } from "@/modules/attendance/schema";
import { attendancePercent } from "@/modules/attendance/service";
import { listHolidays, rulesFor } from "@/modules/batches/repo";
import { rulesOn, summarizeSchedule } from "@/modules/batches/schedule";
import { enrollmentsOfStudent } from "@/modules/enrollments/repo";
import { isCurrentEnrollment } from "@/modules/enrollments/service";
import { isOverdue } from "@/modules/fees/billing";
import { getInvoice, listInvoices } from "@/modules/fees/repo";
import { razorpayConnected } from "@/modules/integrations/service";
import { makeShareLink } from "@/modules/messaging/links";
import { getPayment } from "@/modules/payments/repo";
import { type Receipt, receiptOf } from "@/modules/payments/service";
import { getGuardian } from "@/modules/students/repo";
import { getOwnTenant, updateOwnTenant } from "@/modules/tenancy/repo";
import { FAMILY_ACCESS, type FamilyAccess } from "./access";
import { batchBranches, cancelledClasses, type FamilyPayment, familyPayments, linkedChildren, type PortalChild } from "./repo";

// docs/03 §12: a parent, or an adult student as their own guardian, sees the
// children linked to them and their family's fees, read-only. Anything that
// isn't theirs is a 404, like something that doesn't exist.

export type GuardianCtx = { tenantId: string; guardianId: string };
export type { PortalChild };

export const childrenOf = (tx: Tx, g: GuardianCtx): Promise<PortalChild[]> => linkedChildren(tx, g.guardianId);

// Re-read on every request: a removed guardian, or one whose login was turned off, opens nothing.
async function familyOf(tx: Tx, g: GuardianCtx): Promise<string> {
  const guardian = await getGuardian(tx, g.guardianId);
  if (!guardian?.canLogin) throw new NotFoundError("Family");
  return guardian.householdId;
}

// What this person may see: everything about a child they manage, else what
// the academy lets family members see (agreed 2026-10-03).
async function allowed(tx: Tx, manages: boolean): Promise<Set<FamilyAccess>> {
  return new Set(manages ? FAMILY_ACCESS : ((await getOwnTenant(tx))?.familyAccess ?? []));
}

// Family-wide (receipts, paying): managing any of the family's children counts.
async function familyAllowed(tx: Tx, g: GuardianCtx): Promise<Set<FamilyAccess>> {
  return allowed(tx, (await childrenOf(tx, g)).some((c) => c.isManager));
}

export type ChildAttendance = { days: { date: string; mark: Mark | null; batchName: string }[]; counts: Record<Mark, number>; percent: number | null };
export type ChildFee = { id: string; number: string | null; dueDate: string; duePaise: Paise; overdue: boolean; payOnline: boolean };

// attendance and fees are null, and receipts false, when hidden from this person.
export type ChildPage = {
  child: PortalChild;
  children: PortalChild[];
  today: string;
  month: string;
  attendance: ChildAttendance | null;
  fees: ChildFee[] | null;
  receipts: boolean;
  timings: { batchName: string; programName: string; schedule: string; paused: boolean }[];
  notices: { date: string; text: string }[];
};

// One child's page: a month of classes as marked, what is unpaid on their
// invoices, their batches' timings, and holidays or cancelled classes ahead.
export async function childPage(tx: Tx, g: GuardianCtx, studentId: string, opts: { month?: string | undefined; now?: Date } = {}): Promise<ChildPage> {
  const children = await childrenOf(tx, g);
  const child = children.find((c) => c.id === studentId);
  if (!child) throw new NotFoundError("Student");
  const now = opts.now ?? new Date();
  const today = todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata", now);
  const month = opts.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month) && opts.month < today.slice(0, 7) ? opts.month : today.slice(0, 7);
  const last = monthEnd(month);

  const [own, family] = [await allowed(tx, child.isManager), await allowed(tx, children.some((c) => c.isManager))];
  let attendance: ChildAttendance | null = null;
  if (own.has("attendance")) {
    const days = (await studentClasses(tx, studentId, `${month}-01`, last < today ? last : today, now)).map((c) => ({ date: c.date, mark: c.mark, batchName: c.batchName }));
    const counts: Record<Mark, number> = { present: 0, late: 0, absent: 0, excused: 0 };
    for (const d of days) if (d.mark) counts[d.mark]++;
    attendance = { days, counts, percent: attendancePercent(counts) };
  }

  const current = (await enrollmentsOfStudent(tx, studentId)).filter((e) => isCurrentEnrollment(e, today));
  const batchIds = [...new Set(current.map((e) => e.batchId))];
  const rules = await rulesFor(tx, batchIds);
  const soon = addDays(today, 30);
  const holidays = batchIds.length ? await listHolidays(tx, await batchBranches(tx, batchIds), { from: today, to: soon }) : [];
  const cancelled = await cancelledClasses(tx, batchIds, today, soon);
  const online = await razorpayConnected(tx);

  return {
    child,
    children,
    today,
    month,
    attendance,
    fees: own.has("fees")
      ? (await listInvoices(tx, [], { view: "unpaid", today, studentId })).map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, duePaise: i.totalPaise - i.paidPaise, overdue: isOverdue(i, today), payOnline: online && family.has("pay") }))
      : null,
    receipts: family.has("receipts"),
    timings: current.map((e) => ({ batchName: e.batchName, programName: e.programName, schedule: summarizeSchedule(rulesOn(rules.filter((r) => r.batchId === e.batchId), today)), paused: e.status === "paused" })),
    notices: [...holidays.map((h) => ({ date: h.date, text: `${h.name}, no class` })), ...cancelled.map((c) => ({ date: c.date, text: `${c.batchName} cancelled${c.reason ? `: ${c.reason}` : ""}` }))].sort((x, y) => x.date.localeCompare(y.date)),
  };
}

export async function familyReceipts(tx: Tx, g: GuardianCtx): Promise<FamilyPayment[]> {
  const family = await familyOf(tx, g);
  if (!(await familyAllowed(tx, g)).has("receipts")) throw new NotFoundError("Receipts");
  return familyPayments(tx, family);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function portalReceipt(tx: Tx, g: GuardianCtx, paymentId: string): Promise<Receipt> {
  const family = await familyOf(tx, g);
  if (!(await familyAllowed(tx, g)).has("receipts")) throw new NotFoundError("Receipt");
  const p = UUID.test(paymentId) ? await getPayment(tx, [], paymentId) : undefined;
  if (!p || p.householdId !== family || p.status === "cancelled") throw new NotFoundError("Receipt");
  return receiptOf(tx, p);
}

// "Pay online": the invoice's private page, which has Pay when Razorpay is
// connected (agreed 2026-09-26). Only an unpaid invoice of this family.
export async function payLink(tx: Tx, g: GuardianCtx, invoiceId: string): Promise<string> {
  const family = await familyOf(tx, g);
  if (!(await familyAllowed(tx, g)).has("pay")) throw new NotFoundError("Invoice");
  const inv = UUID.test(invoiceId) ? await getInvoice(tx, [], invoiceId) : undefined;
  if (!inv || inv.householdId !== family || (inv.status !== "issued" && inv.status !== "part_paid")) throw new NotFoundError("Invoice");
  return `/i/${await makeShareLink(tx, { actorType: "guardian", actorId: g.guardianId, tenantId: g.tenantId }, "invoice", inv.id)}`;
}

// Settings: what family members who aren't a student's manager see.
export async function saveFamilyAccess(tx: Tx, ctx: ScopedCtx, input: unknown): Promise<FamilyAccess[]> {
  assertCan(ctx, "settings:manage");
  const keys = z.array(z.enum(FAMILY_ACCESS)).parse(input);
  const next = FAMILY_ACCESS.filter((k) => keys.includes(k));
  const before = (await getOwnTenant(tx))?.familyAccess ?? [];
  await updateOwnTenant(tx, ctx.tenantId, { familyAccess: next });
  await writeAudit(tx, { actorType: "staff", actorId: ctx.staffId, tenantId: ctx.tenantId, action: "settings.family_access", entityType: "tenant", entityId: ctx.tenantId, before: { familyAccess: before }, after: { familyAccess: next } });
  return next;
}
