import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { isIsoDate } from "@/lib/dates";
import { type Paise, sum } from "@/lib/money/paise";
import { duesByFamily, type FamilyDues } from "@/modules/fees/repo";
import { paymentsRecordedBetween, type SheetPayment } from "@/modules/payments/repo";
import { COUNTED } from "@/modules/payments/service";
import { joinedBetween, leftBetween, type StudentMove } from "@/modules/students/repo";
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
