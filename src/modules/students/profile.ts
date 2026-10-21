import { allows } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { sum } from "@/lib/money/paise";
import type { InvoiceRow } from "@/modules/fees/repo";
import { attendanceTrend, studentAttendance } from "@/modules/attendance/service";
import { studentBatches } from "@/modules/enrollments/service";
import { nextDue, studentCardPlans, studentFees } from "@/modules/fees/service";
import { receiptsOfInvoices } from "@/modules/payments/service";
import { studentOverview } from "./service";

const CARD_INVOICES = 6;

// A term plan's later installments that are not yet due read Upcoming; the earliest unpaid one and past-due ones keep their word.
function laterInstallments(list: InvoiceRow[]): Set<string> {
  const out = new Set<string>();
  const series = new Map<string, InvoiceRow[]>();
  for (const i of list) if (i.installment) series.set(`${i.billToName}|${i.installment.of}|${i.programs.join()}`, [...(series.get(`${i.billToName}|${i.installment.of}|${i.programs.join()}`) ?? []), i]);
  for (const group of series.values()) {
    let first = true;
    for (const i of group.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))) {
      if (i.display !== "due" && i.display !== "overdue" && i.display !== "part_paid") continue;
      if (!first && i.display === "due") out.add(i.id);
      first = false;
    }
  }
  return out;
}

// The fees card: this student's invoices (one per payer per month), the discounts and the receipts on the latest few. Void and draft are not bills.
async function feeCard(tx: Tx, ctx: ScopedCtx, id: string) {
  const { today, discounts, invoices } = await studentFees(tx, ctx, id);
  const billed = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
  const later = laterInstallments(billed);
  const receipts = (await receiptsOfInvoices(tx, ctx, billed.slice(0, CARD_INVOICES).map((i) => i.id))).slice(0, 5);
  const totals = { billedPaise: sum(billed.map((i) => i.totalPaise)), paidPaise: sum(billed.map((i) => i.paidPaise)), outstandingPaise: 0n };
  totals.outstandingPaise = totals.billedPaise - totals.paidPaise;
  return { today, discounts, invoices: billed, upcoming: [...later], receipts, totals, ...(await studentCardPlans(tx, ctx, id, today)) };
}

// The overview, and only the blocks the viewer may see: no attendance key without attendance:read, no batches key without batches:read, no nextDue or fees without invoices:read.
export async function studentProfile(tx: Tx, ctx: ScopedCtx, id: string) {
  const overview = await studentOverview(tx, ctx, id);
  return {
    ...overview,
    ...(allows(ctx, "batches:read") ? { batches: await studentBatches(tx, ctx, id) } : {}),
    ...(allows(ctx, "attendance:read") ? { attendance: { summary: await studentAttendance(tx, ctx, id), trend: await attendanceTrend(tx, ctx, id) } } : {}),
    ...(allows(ctx, "invoices:read") ? { nextDue: await nextDue(tx, ctx, id), fees: await feeCard(tx, ctx, id) } : {}),
  };
}

export type StudentProfile = Awaited<ReturnType<typeof studentProfile>>;
