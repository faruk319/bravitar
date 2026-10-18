import { allows } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { attendanceTrend, studentAttendance } from "@/modules/attendance/service";
import { studentBatches } from "@/modules/enrollments/service";
import { nextDue, studentFees } from "@/modules/fees/service";
import { receiptsOfInvoices } from "@/modules/payments/service";
import { studentOverview } from "./service";

const CARD_INVOICES = 6;

// The fees card: this student's invoices (one per payer per month), the discounts and the receipts on the latest few. Void and draft are not bills.
async function feeCard(tx: Tx, ctx: ScopedCtx, id: string) {
  const { today, discounts, invoices } = await studentFees(tx, ctx, id);
  const billed = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
  return { today, discounts, invoices: billed, receipts: (await receiptsOfInvoices(tx, ctx, billed.slice(0, CARD_INVOICES).map((i) => i.id))).slice(0, 5) };
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
