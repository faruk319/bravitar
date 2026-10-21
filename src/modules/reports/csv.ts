import { rupeesText } from "@/lib/money/format";
import type { MarkCounts } from "@/modules/attendance/repo";
import { LOST_REASON_LABELS, SOURCE_LABELS } from "@/modules/enquiries/lists";
import type { EnquiryReport } from "@/modules/enquiries/service";
import { DISPLAY_LABEL, METHOD_LABEL } from "@/modules/payments/labels";
import type { DiscountLine } from "@/modules/fees/repo";
import type { AdvanceHolder, PaymentRow } from "@/modules/payments/repo";
import type { PaymentMethod } from "@/modules/payments/schema";
import { LEFT_REASON_LABELS } from "@/modules/students/schema";
import { AT_RISK, type AdmissionsReport, type AtRisk, type AttendanceReport, type CollectionRegister, type DuesReport, type RevenueReport } from "./service";

// Each report as spreadsheet rows; amounts in plain rupees so Excel can add them up.

export function collectionRows(r: CollectionRegister): string[][] {
  const totals = (title: string, xs: CollectionRegister["byDay"], back: CollectionRegister["byDay"], label: (k: string) => string = (k) => k) => [
    [title, "Receipts", "Amount"],
    ...xs.map((t) => [label(t.key), String(t.count), rupeesText(t.totalPaise)]),
    ...back.map((t) => [`Refunded ${label(t.key)}`, String(t.count), rupeesText(t.totalPaise)]),
    [],
  ];
  return [
    ["Collection register", `${r.from} to ${r.to}`],
    [],
    ["Recorded on", "Receipt", "Family", "Method", "Collected by", "Amount", "Status"],
    ...r.rows.map((p) => [p.recordedOn, p.receiptNumber, p.billToName, METHOD_LABEL[p.method], p.collectorName ?? "Online", rupeesText(p.amountPaise), p.status === "cancelled" ? `Cancelled: ${p.cancelReason ?? ""}` : ""]),
    ["Total", String(r.total.count), "", "", "", rupeesText(r.total.totalPaise), ""],
    ["Refunded", String(r.refunds.count), "", "", "", rupeesText(r.refunds.totalPaise), ""],
    [],
    ...totals("By day", r.byDay, r.refunds.byDay),
    ...totals("By method", r.byMethod, r.refunds.byMethod, (k) => METHOD_LABEL[k as PaymentMethod]),
    ...totals("By staff", r.byCollector, r.refunds.byCollector),
  ];
}

// The collections table as rows: the header, then one row a payment, whatever page it was on.
export function collectionsRows(rows: PaymentRow[]): string[][] {
  return [
    ["Recorded on", "Receipt", "Students", "Payer", "Programs", "Towards", "Advance", "Amount", "Refunded", "Method", "Reference", "Collected by", "Status"],
    ...rows.map((p) => [
      p.recordedOn,
      p.receiptNumber,
      p.students.join(", "),
      p.billToName,
      p.programs.join(", "),
      p.towards.map((t) => t.number ?? "Draft").join(", "),
      rupeesText(p.advancePaise),
      rupeesText(p.amountPaise),
      rupeesText(p.refundedPaise),
      METHOD_LABEL[p.method],
      p.reference ?? "",
      p.collectorName ?? "Online",
      p.display === "cancelled" ? `Cancelled: ${p.cancelReason ?? ""}` : DISPLAY_LABEL[p.display],
    ]),
  ];
}

export function duesRows(r: DuesReport): string[][] {
  const t = r.totals;
  return [
    ["Outstanding dues", `as of ${r.asOf}`, "days past the due date"],
    [],
    ["Payer", "Invoices", "Not yet due", "0-30 days", "31-60 days", "Over 60 days", "Total"],
    ...r.payers.map((f) => [f.name, String(f.invoices), ...[f.notDue, f.days0to30, f.days31to60, f.over60, f.notDue + f.days0to30 + f.days31to60 + f.over60].map(rupeesText)]),
    ["Total", String(t.invoices), ...[t.notDue, t.days0to30, t.days31to60, t.over60, t.notDue + t.days0to30 + t.days31to60 + t.over60].map(rupeesText)],
  ];
}

export function admissionsRows(r: AdmissionsReport): string[][] {
  return [
    ["Admissions and dropouts", `${r.from} to ${r.to}`],
    [],
    ["", "Student", "Code", "Date", "Reason"],
    ...r.joined.map((s) => ["Joined", s.fullName, s.code, s.on, ""]),
    ...r.left.map((s) => ["Left", s.fullName, s.code, s.on, s.leftReason ? LEFT_REASON_LABELS[s.leftReason] : ""]),
    [],
    ["Joined", String(r.joined.length)],
    ["Left", String(r.left.length)],
  ];
}

const marks = (c: MarkCounts & { percent: number | null }) => [c.present, c.late, c.absent, c.excused].map(String).concat(c.percent === null ? "" : String(c.percent));

export function attendanceRows(r: AttendanceReport): string[][] {
  return [
    ["Attendance summary", `${r.from} to ${r.to}`, "% = (present + late) / (present + late + absent)"],
    [],
    ["Batch", "Classes", "Present", "Late", "Absent", "Excused", "%"],
    ...r.batches.map((b) => [b.batchName, String(b.classes), ...marks(b)]),
    [],
    ["Student", "Code", "Present", "Late", "Absent", "Excused", "%"],
    ...r.students.map((s) => [s.name, s.code, ...marks(s)]),
  ];
}

export function atRiskRows(r: AtRisk): string[][] {
  return [
    ["At risk", `${r.from} to ${r.to}`],
    ...(r.attendance
      ? [[], [`Attendance under ${AT_RISK.below}%`], ["Student", "Code", "Present", "Late", "Absent", "Excused", "%"], ...r.attendance.map((s) => [s.name, s.code, ...marks(s)])]
      : []),
    ...(r.unpaid ? [[], [`${AT_RISK.overdue} or more invoices overdue`], ["Student", "Code", "Overdue invoices", "Owed"], ...r.unpaid.map((s) => [s.name, s.code, String(s.overdue), rupeesText(s.owedPaise)])] : []),
  ];
}

export function enquiryRows(r: EnquiryReport): string[][] {
  const f = r.funnel;
  const pct = (n: number, of: number) => (of ? String(Math.round((n / of) * 100)) : "");
  const stages: [string, number][] = [
    ["Received", f.received],
    ["Contacted", f.contacted],
    ["Trial booked", f.trialBooked],
    ["Trial done", f.trialDone],
    ["Joined", f.won],
    ["Lost", f.lost],
  ];
  return [
    ["Enquiry funnel", `${r.from} to ${r.to}`],
    [],
    ["Stage", "Enquiries", "% of received"],
    ...stages.map(([label, n]) => [label, String(n), pct(n, f.received)]),
    [],
    ["Source", "Received", "Joined", "% joined"],
    ...r.sources.map((s) => [s.source ? SOURCE_LABELS[s.source] : "Not set", String(s.received), String(s.won), pct(s.won, s.received)]),
    [],
    ["Why they were lost", "Enquiries"],
    ...r.lost.map((l) => [l.reason ? LOST_REASON_LABELS[l.reason] : "No reason", String(l.count)]),
  ];
}

export function discountLineRows(lines: DiscountLine[]): string[][] {
  return [["Invoice", "Issued", "Student", "Line", "Discount", "Reason"], ...lines.map((l) => [l.number ?? "Draft", l.issueDate, l.studentName ?? "", l.description, rupeesText(l.discountPaise), l.discountNote ?? ""])];
}

export function advanceRows(rows: AdvanceHolder[]): string[][] {
  return [["Payer", "Students", "Branch", "Advance", "Since", "Receipts", "Still owes"], ...rows.map((r) => [r.name, r.children.join(", "), r.branchName, rupeesText(r.advancePaise), r.since, r.receipts.map((x) => x.receiptNumber).join(", "), rupeesText(r.owesPaise)])];
}

// One row per program (its batches added up), then the advance no invoice took.
export function revenueRows(r: RevenueReport, activity: (key: string) => string): string[][] {
  const programs = new Map<string, RevenueReport["rows"][number]>();
  for (const x of r.rows) {
    const key = x.programId ?? "";
    const p = programs.get(key);
    programs.set(key, p ? { ...p, billedPaise: p.billedPaise + x.billedPaise, collectedPaise: p.collectedPaise + x.collectedPaise, outstandingPaise: p.outstandingPaise + x.outstandingPaise } : x);
  }
  return [
    ["Activity", "Program", "Billed", "Collected", "Outstanding"],
    ...[...programs.values()].map((x) => [x.activityKey ? activity(x.activityKey) : "", x.programName, rupeesText(x.billedPaise), rupeesText(x.collectedPaise), rupeesText(x.outstandingPaise)]),
    ["Advance", "", "", rupeesText(r.advancePaise), ""],
  ];
}
