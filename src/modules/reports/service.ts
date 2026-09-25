import { z } from "zod";
import { allows, assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { addDays, isIsoDate } from "@/lib/dates";
import { type Paise, sum } from "@/lib/money/paise";
import { type BatchMarks, type MarkCounts, marksByBatch, marksByStudent, type StudentMarks } from "@/modules/attendance/repo";
import { attendancePercent } from "@/modules/attendance/service";
import { type EnquiryReport, enquiryReport } from "@/modules/enquiries/service";
import { duesByFamily, type FamilyDues, familiesOverdue } from "@/modules/fees/repo";
import { paymentsRecordedBetween, type SheetPayment } from "@/modules/payments/repo";
import { COUNTED } from "@/modules/payments/service";
import { activeStudentsOf, joinedBetween, leftBetween, type StudentMove } from "@/modules/students/repo";
import { tenantToday } from "@/modules/tenancy/repo";

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
export type CollectionRegister = Range & { rows: SheetPayment[]; total: Total; byDay: Total[]; byMethod: Total[]; byCollector: Total[] };

// Counted by the day each payment was recorded, as the collection sheet is,
// so a day's total here equals that day's sheet (docs/03 §11 acceptance).
export async function collectionRegister(tx: Tx, ctx: ScopedCtx, input: Range): Promise<CollectionRegister> {
  assertCan(ctx, "reports:view");
  const range = rangeSchema.parse(input);
  const rows = await paymentsRecordedBetween(tx, ctx.branchIds, range.from, range.to);
  const counted = rows.filter((p) => COUNTED.has(p.status));
  const by = (key: (p: SheetPayment) => string): Total[] => {
    const out = new Map<string, Total>();
    for (const p of counted) {
      const k = key(p);
      const t = out.get(k) ?? { key: k, count: 0, totalPaise: 0n };
      out.set(k, { key: k, count: t.count + 1, totalPaise: t.totalPaise + p.amountPaise });
    }
    return [...out.values()];
  };
  return {
    ...range,
    rows,
    total: { key: "total", count: counted.length, totalPaise: sum(counted.map((p) => p.amountPaise)) },
    byDay: by((p) => p.recordedOn),
    byMethod: by((p) => p.method),
    byCollector: by((p) => p.collectorName ?? "Online"),
  };
}

export type DuesTotals = Omit<FamilyDues, "householdId" | "name">;
export type DuesReport = { asOf: string; families: FamilyDues[]; totals: DuesTotals };

// A snapshot as of today: what is owed now, aged by days past the due date.
export async function outstandingDues(tx: Tx, ctx: ScopedCtx): Promise<DuesReport> {
  assertCan(ctx, "reports:view");
  const asOf = await tenantToday(tx);
  const families = await duesByFamily(tx, ctx.branchIds, asOf);
  const add = (k: "notDue" | "days0to30" | "days31to60" | "over60") => sum(families.map((f) => f[k]));
  return { asOf, families, totals: { invoices: families.reduce((n, f) => n + f.invoices, 0), notDue: add("notDue"), days0to30: add("days0to30"), days31to60: add("days31to60"), over60: add("over60") } };
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
    const families = new Map((await familiesOverdue(tx, ctx.branchIds, to, AT_RISK.overdue)).map((f) => [f.householdId, f]));
    unpaid = (await activeStudentsOf(tx, { branchIds: ctx.branchIds }, [...families.keys()])).map((s) => ({
      studentId: s.id,
      name: s.fullName,
      code: s.code,
      overdue: families.get(s.householdId)?.overdue ?? 0,
      owedPaise: families.get(s.householdId)?.owedPaise ?? 0n,
    }));
  }
  return { from, to, attendance, unpaid };
}

// The enquiry tab's report, for its CSV.
export async function enquiryFunnel(tx: Tx, ctx: ScopedCtx, input: Range): Promise<EnquiryReport> {
  assertCan(ctx, "reports:view");
  return enquiryReport(tx, ctx, input);
}
