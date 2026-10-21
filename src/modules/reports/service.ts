import { z } from "zod";
import { allows, assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { addDays, isIsoDate, todayIn } from "@/lib/dates";
import { type Paise, sum } from "@/lib/money/paise";
import { type BatchMarks, type MarkCounts, marksByBatch, marksByStudent, type StudentMarks } from "@/modules/attendance/repo";
import { attendancePercent } from "@/modules/attendance/service";
import { type EnquiryReport, enquiryReport } from "@/modules/enquiries/service";
import { spreadOver } from "@/modules/fees/billing";
import { draftSummary, duesByPayer, issuedLinesBetween, linesWithProgram, owedSummary, type PayerDues, payersOverdue, statusMix } from "@/modules/fees/repo";
import { balanceShares } from "@/modules/fees/service";
import { advanceHolders, collectedByDay, collectedOn, paymentsRecordedBetween, receiptAllocationsBetween, refundedBetween, type SheetPayment } from "@/modules/payments/repo";
import { COUNTED } from "@/modules/payments/service";
import { payerKey } from "@/modules/students/payer";
import { activeStudentsOf, joinedBetween, leftBetween, type StudentMove } from "@/modules/students/repo";
import { getOwnTenant, tenantToday } from "@/modules/tenancy/repo";

// docs/03 §11: every report has a date range, is branch-scoped for
// branch-scoped staff, and exports to CSV (csv.ts).

const isoDate = z.string().refine(isIsoDate, "Use YYYY-MM-DD");
export const rangeSchema = z.object({ from: isoDate, to: isoDate }).refine((r) => r.from <= r.to, "The start comes after the end");
export type Range = z.infer<typeof rangeSchema>;

// This month so far: every report's default.
export async function thisMonth(tx: Tx): Promise<Range> {
  const today = await tenantToday(tx);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export type Total = { key: string; count: number; totalPaise: Paise };
function totalsBy(counted: SheetPayment[], key: (p: SheetPayment) => string): Total[] {
  const out = new Map<string, Total>();
  for (const p of counted) {
    const k = key(p);
    const t = out.get(k) ?? { key: k, count: 0, totalPaise: 0n };
    out.set(k, { key: k, count: t.count + 1, totalPaise: t.totalPaise + p.amountPaise });
  }
  return [...out.values()];
}

export type CollectionRegister = Range & { rows: SheetPayment[]; total: Total; byDay: Total[]; byMethod: Total[]; byCollector: Total[] };

// Counted by the day each payment was recorded, as the collection sheet is,
// so a day's total here equals that day's sheet (docs/03 §11 acceptance).
export async function collectionRegister(tx: Tx, ctx: ScopedCtx, input: Range): Promise<CollectionRegister> {
  assertCan(ctx, "reports:view");
  const range = rangeSchema.parse(input);
  const rows = await paymentsRecordedBetween(tx, ctx.branchIds, range.from, range.to);
  const counted = rows.filter((p) => COUNTED.has(p.status));
  const by = (key: (p: SheetPayment) => string) => totalsBy(counted, key);
  return {
    ...range,
    rows,
    total: { key: "total", count: counted.length, totalPaise: sum(counted.map((p) => p.amountPaise)) },
    byDay: by((p) => p.recordedOn),
    byMethod: by((p) => p.method),
    byCollector: by((p) => p.collectorName ?? "Online"),
  };
}

export type DuesTotals = Omit<PayerDues, "payerKey" | "name">;
export type DuesReport = { asOf: string; payers: PayerDues[]; totals: DuesTotals };

// A snapshot as of today: what is owed now, aged by days past the due date.
export async function outstandingDues(tx: Tx, ctx: ScopedCtx): Promise<DuesReport> {
  assertCan(ctx, "reports:view");
  const asOf = await tenantToday(tx);
  const payers = await duesByPayer(tx, ctx.branchIds, asOf);
  const add = (k: "notDue" | "days0to30" | "days31to60" | "over60") => sum(payers.map((f) => f[k]));
  return { asOf, payers, totals: { invoices: payers.reduce((n, f) => n + f.invoices, 0), notDue: add("notDue"), days0to30: add("days0to30"), days31to60: add("days31to60"), over60: add("over60") } };
}

export type AdmissionsReport = Range & { joined: StudentMove[]; left: StudentMove[] };

export async function admissionsReport(tx: Tx, ctx: ScopedCtx, input: Range): Promise<AdmissionsReport> {
  assertCan(ctx, "reports:view");
  const range = rangeSchema.parse(input);
  const scope = { branchIds: ctx.branchIds };
  return { ...range, joined: await joinedBetween(tx, scope, range.from, range.to), left: await leftBetween(tx, scope, range.from, range.to) };
}

// The register's receipts as chart columns: one per day, or per month past 62 days.
export type Bucket = { from: string; to: string; count: number; totalPaise: Paise };
export function collectionBuckets(r: Pick<CollectionRegister, "from" | "to" | "byDay">): { unit: "day" | "month"; buckets: Bucket[] } {
  const unit = addDays(r.from, 62) <= r.to ? "month" : "day";
  const keyOf = (day: string) => (unit === "day" ? day : day.slice(0, 7));
  const out = new Map<string, Bucket>();
  for (let day = r.from; day <= r.to; day = addDays(day, 1)) {
    const b = out.get(keyOf(day));
    out.set(keyOf(day), b ? { ...b, to: day } : { from: day, to: day, count: 0, totalPaise: 0n });
  }
  for (const t of r.byDay) {
    const b = out.get(keyOf(t.key));
    if (b) out.set(keyOf(t.key), { ...b, count: b.count + t.count, totalPaise: b.totalPaise + t.totalPaise });
  }
  return { unit, buckets: [...out.values()] };
}

// ---- attendance (docs/03 §11): by batch and by student; trials aren't students

type WithPercent<T> = T & { percent: number | null };
const withPercent = <T extends MarkCounts>(x: T): WithPercent<T> => ({ ...x, percent: attendancePercent(x) });
export type AttendanceReport = Range & { batches: WithPercent<BatchMarks>[]; students: WithPercent<StudentMarks>[] };

export async function attendanceReport(tx: Tx, ctx: ScopedCtx, input: Range): Promise<AttendanceReport> {
  assertCan(ctx, "reports:view");
  const range = rangeSchema.parse(input);
  return {
    ...range,
    batches: (await marksByBatch(tx, ctx.branchIds, range.from, range.to)).map(withPercent),
    students: (await marksByStudent(tx, ctx.branchIds, range.from, range.to)).map(withPercent),
  };
}

// ---- at risk (agreed 2026-09-25): under 60% attendance in the last 30 days,
// or a family with two or more invoices past their due date, not fully paid.

export const AT_RISK = { days: 30, below: 60, overdue: 2 };
export type AtRisk = Range & {
  attendance: WithPercent<StudentMarks>[] | null;
  unpaid: { studentId: string; name: string; code: string; overdue: number; owedPaise: Paise }[] | null;
};

// Each part only for those who may see it (attendance, invoices); null otherwise.
export async function atRisk(tx: Tx, ctx: ScopedCtx): Promise<AtRisk> {
  assertCan(ctx, "students:read");
  const to = await tenantToday(tx);
  const from = addDays(to, -(AT_RISK.days - 1));
  // Exact, not the rounded percent: 59.6% is under 60.
  const low = (c: MarkCounts) => c.present + c.late + c.absent > 0 && (c.present + c.late) * 100 < AT_RISK.below * (c.present + c.late + c.absent);
  const attendance = allows(ctx, "attendance:read")
    ? (await marksByStudent(tx, ctx.branchIds, from, to))
        .filter((s) => s.active && low(s))
        .map(withPercent)
        .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))
    : null;
  let unpaid: AtRisk["unpaid"] = null;
  if (allows(ctx, "invoices:read")) {
    const overdue = await payersOverdue(tx, ctx.branchIds, to, AT_RISK.overdue);
    const byPayer = new Map(overdue.map((o) => [payerKey(o.payer), o]));
    const sums = new Map<string, { studentId: string; name: string; code: string; overdue: number; owedPaise: Paise }>();
    for (const { payerKey: k, student: s } of await activeStudentsOf(tx, { branchIds: ctx.branchIds }, overdue.map((o) => o.payer))) {
      const o = byPayer.get(k);
      const t = sums.get(s.id) ?? { studentId: s.id, name: s.fullName, code: s.code, overdue: 0, owedPaise: 0n };
      sums.set(s.id, { ...t, overdue: t.overdue + (o?.overdue ?? 0), owedPaise: t.owedPaise + (o?.owedPaise ?? 0n) });
    }
    unpaid = [...sums.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  return { from, to, attendance, unpaid };
}

// The enquiry tab's report, for its CSV.
export async function enquiryFunnel(tx: Tx, ctx: ScopedCtx, input: Range): Promise<EnquiryReport> {
  assertCan(ctx, "reports:view");
  return enquiryReport(tx, ctx, input);
}

// ---- finance overview (Task 16)

export type RevenueRow = { activityKey: string; programId: string | null; programName: string; batchId: string | null; batchName: string | null; billedPaise: Paise; collectedPaise: Paise; outstandingPaise: Paise };
export type RevenueReport = Range & { rows: RevenueRow[]; advancePaise: Paise; collectedPaise: Paise; refundsPaise: Paise };

export const NOT_LINKED = "Not linked to a program";
type Linked = { activityKey: string | null; programId: string | null; programName: string | null; batchId: string | null; batchName: string | null };

// Collected is each receipt spread over its invoice's lines by amount and tax; what no invoice took is advance.
// Billed is the lines of invoices issued in the range, after discount and before tax; outstanding is their open balance.
export async function revenueReport(tx: Tx, ctx: ScopedCtx, input: Range): Promise<RevenueReport> {
  const money = allows(ctx, "payments:read");
  const bills = allows(ctx, "invoices:read");
  if (!money) assertCan(ctx, "invoices:read");
  const range = rangeSchema.parse(input);
  const rows = new Map<string, RevenueRow>();
  const rowOf = (l: Linked): RevenueRow => {
    const key = l.programId ? `${l.programId}|${l.batchId ?? ""}` : "";
    const row = rows.get(key) ?? { activityKey: l.activityKey ?? "", programId: l.programId, programName: l.programName ?? NOT_LINKED, batchId: l.batchId, batchName: l.batchName, billedPaise: 0n, collectedPaise: 0n, outstandingPaise: 0n };
    rows.set(key, row);
    return row;
  };
  const none: Linked = { activityKey: null, programId: null, programName: null, batchId: null, batchName: null };
  let advancePaise = 0n;
  let collectedPaise = 0n;
  let refundsPaise = 0n;
  if (money) {
    const paid = await receiptAllocationsBetween(tx, ctx.branchIds, range.from, range.to);
    const lines = await linesWithProgram(tx, [...new Set(paid.flatMap((p) => p.receipts.map((r) => r.invoiceId)))]);
    const byInvoice = new Map<string, typeof lines>();
    for (const l of lines) byInvoice.set(l.invoiceId, [...(byInvoice.get(l.invoiceId) ?? []), l]);
    for (const p of paid) {
      collectedPaise += p.amountPaise;
      advancePaise += p.amountPaise - sum(p.receipts.map((r) => r.amountPaise));
      for (const r of p.receipts) {
        const on = byInvoice.get(r.invoiceId) ?? [];
        if (!on.length) rowOf(none).collectedPaise += r.amountPaise;
        const shares = spreadOver(r.amountPaise, on.map((l) => ({ id: l.lineId, weight: l.weight })));
        for (const l of on) rowOf(l).collectedPaise += shares.get(l.lineId) ?? 0n;
      }
    }
    refundsPaise = await refundedBetween(tx, ctx.branchIds, range.from, range.to);
  }
  if (bills) {
    const issued = await issuedLinesBetween(tx, ctx.branchIds, range.from, range.to);
    const open = issued.filter((l) => l.status !== "paid");
    const shares = balanceShares(open.map((l) => ({ invoiceId: l.invoiceId, lineId: l.lineId, enrollmentId: null, weight: l.weight, balance: l.balance })));
    for (const l of issued) {
      const row = rowOf(l);
      row.billedPaise += l.amountPaise;
      row.outstandingPaise += shares.get(l.lineId) ?? 0n;
    }
  }
  const sorted = [...rows.values()].sort((a, b) => Number(b.collectedPaise - a.collectedPaise) || Number(b.billedPaise - a.billedPaise) || a.programName.localeCompare(b.programName));
  return { ...range, rows: sorted, advancePaise, collectedPaise, refundsPaise };
}

export type OwedSummary = Awaited<ReturnType<typeof owedSummary>>;
export type StatusMix = Awaited<ReturnType<typeof statusMix>>;
export type Collected = { count: number; total: Paise };
export type FinanceOverview = {
  today: string;
  days: 7 | 30 | 90;
  collected?: { today: Collected; yesterday: Collected; month: Collected; refundsToday: Paise; refundsMonth: Paise; trend: { key: string; totalPaise: Paise }[]; byMethod: Total[] };
  owed?: OwedSummary;
  advance?: { payers: number; owing: number; paise: Paise };
  revenue?: RevenueReport;
  mix?: StatusMix;
  drafts?: { count: number; total: Paise };
};

// Each block only with its key, as dashboardData does: money in needs payments:read, money owed invoices:read.
export async function financeOverview(tx: Tx, ctx: ScopedCtx, opts: { now?: Date; days?: 7 | 30 | 90 } = {}): Promise<FinanceOverview> {
  const tz = (await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata";
  const today = todayIn(tz, opts.now ?? new Date());
  const days = opts.days ?? 30;
  const monthStart = `${today.slice(0, 7)}-01`;
  const out: FinanceOverview = { today, days };
  const b = ctx.branchIds;
  if (allows(ctx, "payments:read")) {
    const from = addDays(today, -(days - 1));
    const [now, yesterday, month, byDay, refundsToday, refundsMonth] = await Promise.all([
      collectedOn(tx, b, today),
      collectedOn(tx, b, addDays(today, -1)),
      paymentsRecordedBetween(tx, b, monthStart, today).then((rows) => rows.filter((p) => COUNTED.has(p.status))),
      collectedByDay(tx, b, from, today),
      refundedBetween(tx, b, today, today),
      refundedBetween(tx, b, monthStart, today),
    ]);
    const daily = new Map(byDay.map((d) => [d.day, d.total]));
    const trend: { key: string; totalPaise: Paise }[] = [];
    for (let day = from; day <= today; day = addDays(day, 1)) trend.push({ key: day, totalPaise: daily.get(day) ?? 0n });
    out.collected = { today: now, yesterday, month: { count: month.length, total: sum(month.map((p) => p.amountPaise)) }, refundsToday, refundsMonth, trend, byMethod: totalsBy(month, (p) => p.method) };
  }
  if (allows(ctx, "invoices:read")) {
    const [owed, holders, mix, drafts] = await Promise.all([owedSummary(tx, b, today), advanceHolders(tx, b), statusMix(tx, b, monthStart, today, today), draftSummary(tx, b)]);
    out.owed = owed;
    out.advance = { payers: new Set(holders.map((h) => h.payerKey)).size, owing: new Set(holders.filter((h) => h.owesPaise > 0n).map((h) => h.payerKey)).size, paise: sum(holders.map((h) => h.advancePaise)) };
    out.mix = mix;
    out.drafts = drafts;
  }
  if (allows(ctx, "payments:read") || allows(ctx, "invoices:read")) out.revenue = await revenueReport(tx, ctx, { from: monthStart, to: today });
  return out;
}
