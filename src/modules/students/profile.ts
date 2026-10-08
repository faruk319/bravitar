import { allows, type AccessContext } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { attendanceTrend, studentAttendance } from "@/modules/attendance/service";
import { studentBatches } from "@/modules/enrollments/service";
import { nextDue, studentFees } from "@/modules/fees/service";
import { receiptsOfInvoices } from "@/modules/payments/service";
import { studentOverview } from "./service";

export const PROFILE_TABS = ["overview", "attendance", "fees", "batches", "documents", "activity"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
export const TAB_LABELS: Record<ProfileTab, string> = { overview: "Overview", attendance: "Attendance", fees: "Fees & Payments", batches: "Batches", documents: "Documents", activity: "Activity" };

// A tab the viewer cannot read is not offered; documents and activity are empty for everyone.
export function profileTabs(ctx: AccessContext): ProfileTab[] {
  const needs: Partial<Record<ProfileTab, Parameters<typeof allows>[1]>> = { attendance: "attendance:read", fees: "invoices:read", batches: "batches:read" };
  return PROFILE_TABS.filter((t) => {
    const p = needs[t];
    return !p || allows(ctx, p);
  });
}

const CARD_INVOICES = 6;

// The fees card: this student's invoices (one per payer per month) and the receipts on the latest few. Void and draft are not bills.
async function feeCard(tx: Tx, ctx: ScopedCtx, id: string) {
  const { today, invoices } = await studentFees(tx, ctx, id);
  const billed = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
  return { today, invoices: billed, receipts: (await receiptsOfInvoices(tx, ctx, billed.slice(0, CARD_INVOICES).map((i) => i.id))).slice(0, 5) };
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
