import { rupeesText } from "@/lib/money/format";
import { METHOD_LABEL } from "@/modules/payments/labels";
import type { PaymentMethod } from "@/modules/payments/schema";
import { LEFT_REASON_LABELS } from "@/modules/students/schema";
import type { AdmissionsReport, CollectionRegister, DuesReport } from "./service";

// Each report as spreadsheet rows; amounts in plain rupees so Excel can add them up.

export function collectionRows(r: CollectionRegister): string[][] {
  const totals = (title: string, xs: CollectionRegister["byDay"], label: (k: string) => string = (k) => k) => [[title, "Receipts", "Amount"], ...xs.map((t) => [label(t.key), String(t.count), rupeesText(t.totalPaise)]), []];
  return [
    ["Collection register", `${r.from} to ${r.to}`],
    [],
    ["Recorded on", "Receipt", "Family", "Method", "Collected by", "Amount", "Status"],
    ...r.rows.map((p) => [p.recordedOn, p.receiptNumber, p.householdName, METHOD_LABEL[p.method], p.collectorName ?? "Online", rupeesText(p.amountPaise), p.status === "cancelled" ? `Cancelled: ${p.cancelReason ?? ""}` : ""]),
    ["Total", String(r.total.count), "", "", "", rupeesText(r.total.totalPaise), ""],
    [],
    ...totals("By day", r.byDay),
    ...totals("By method", r.byMethod, (k) => METHOD_LABEL[k as PaymentMethod]),
    ...totals("By staff", r.byCollector),
  ];
}

export function duesRows(r: DuesReport): string[][] {
  const t = r.totals;
  return [
    ["Outstanding dues", `as of ${r.asOf}`, "days past the due date"],
    [],
    ["Family", "Invoices", "Not yet due", "0-30 days", "31-60 days", "Over 60 days", "Total"],
    ...r.families.map((f) => [f.name, String(f.invoices), ...[f.notDue, f.days0to30, f.days31to60, f.over60, f.notDue + f.days0to30 + f.days31to60 + f.over60].map(rupeesText)]),
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
