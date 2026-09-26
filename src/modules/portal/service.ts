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
import { listInvoices } from "@/modules/fees/repo";
import { razorpayConnected } from "@/modules/integrations/service";
import { getPayment } from "@/modules/payments/repo";
import { type Receipt, receiptOf } from "@/modules/payments/service";
import { getGuardian } from "@/modules/students/repo";
import { getOwnTenant } from "@/modules/tenancy/repo";
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

export type ChildPage = {
  child: PortalChild;
  children: PortalChild[];
  today: string;
  month: string;
  attendance: { days: { date: string; mark: Mark | null; batchName: string }[]; counts: Record<Mark, number>; percent: number | null };
  fees: { id: string; number: string | null; dueDate: string; duePaise: Paise; overdue: boolean; payOnline: boolean }[];
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

  const days = (await studentClasses(tx, studentId, `${month}-01`, last < today ? last : today, now)).map((c) => ({ date: c.date, mark: c.mark, batchName: c.batchName }));
  const counts: Record<Mark, number> = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const d of days) if (d.mark) counts[d.mark]++;

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
    attendance: { days, counts, percent: attendancePercent(counts) },
    fees: (await listInvoices(tx, [], { view: "unpaid", today, studentId })).map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, duePaise: i.totalPaise - i.paidPaise, overdue: isOverdue(i, today), payOnline: online })),
    timings: current.map((e) => ({ batchName: e.batchName, programName: e.programName, schedule: summarizeSchedule(rulesOn(rules.filter((r) => r.batchId === e.batchId), today)), paused: e.status === "paused" })),
    notices: [...holidays.map((h) => ({ date: h.date, text: `${h.name}, no class` })), ...cancelled.map((c) => ({ date: c.date, text: `${c.batchName} cancelled${c.reason ? `: ${c.reason}` : ""}` }))].sort((x, y) => x.date.localeCompare(y.date)),
  };
}

export async function familyReceipts(tx: Tx, g: GuardianCtx): Promise<FamilyPayment[]> {
  return familyPayments(tx, await familyOf(tx, g));
}

export async function portalReceipt(tx: Tx, g: GuardianCtx, paymentId: string): Promise<Receipt> {
  const family = await familyOf(tx, g);
  const p = /^[0-9a-f-]{36}$/i.test(paymentId) ? await getPayment(tx, [], paymentId) : undefined;
  if (!p || p.householdId !== family || p.status === "cancelled") throw new NotFoundError("Receipt");
  return receiptOf(tx, p);
}
