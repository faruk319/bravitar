import { addDays } from "@/lib/dates";
import { type Paise, percent, roundHalfUp, split, sum } from "@/lib/money/paise";
import type { Invoice } from "./schema";

// Pure billing rules (docs/04, docs/03 §8 agreed 2026-09-24). No database here.

export type Cycle = "monthly" | "quarterly" | "half_yearly" | "yearly";
export type Period = { start: string; end: string };
const MONTHS: Record<Cycle, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

// Billing days are 1–28, so the day always exists.
export function addMonths(date: string, n: number): string {
  const [y = 0, m = 1] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${date.slice(8, 10)}`;
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const days = (p: Period) => Math.round((Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / 86_400_000) + 1;

// The cycle `date` falls in, cycles starting on the billing day of the anchor's month.
export function cycleContaining(anchor: string, cycle: Cycle, billingDay: number, date: string): Period {
  const len = MONTHS[cycle];
  const first = `${anchor.slice(0, 7)}-${String(billingDay).padStart(2, "0")}`;
  let k = Math.floor((monthIndex(date) - monthIndex(first)) / len);
  if (addMonths(first, k * len) > date) k--;
  if (addMonths(first, (k + 1) * len) <= date) k++;
  const start = addMonths(first, k * len);
  return { start, end: addDays(addMonths(first, (k + 1) * len), -1) };
}

export type RecurringInput = {
  cycle: Cycle;
  billingDay: number;
  amount: Paise;
  proration: "full" | "daily";
  anchor: string; // join date of the first enrollment in a move chain
  start: string;
  end: string | null;
  pausedOn: string | null;
  continuing: boolean; // reached by a batch move: the cycle in progress stands
};
export type Charge = { period: Period; issueDate: string; amount: Paise; prorated: boolean };

// Charges billed on a day in [from, to]. A cycle is billed on its first day;
// a mid-cycle join is billed on the join day, full or by days per the academy.
export function recurringCharges(p: RecurringInput, from: string, to: string): Charge[] {
  const out: Charge[] = [];
  for (let c = cycleContaining(p.anchor, p.cycle, p.billingDay, p.start); ; c = cycleContaining(p.anchor, p.cycle, p.billingDay, addDays(c.end, 1))) {
    const partial = p.start > c.start;
    const issueDate = partial ? p.start : c.start;
    if ((p.end && issueDate > p.end) || issueDate > to || (p.pausedOn && p.pausedOn <= issueDate)) break;
    if (partial && p.continuing) continue;
    const period = { start: issueDate, end: c.end };
    const prorated = partial && p.proration === "daily";
    const amount = prorated ? roundHalfUp(p.amount * BigInt(days(period)), BigInt(days(c))) : p.amount;
    if (issueDate >= from) out.push({ period, issueDate, amount, prorated });
  }
  return out;
}

// The next charge to be billed after today, within a year; null when none is coming.
export function nextRecurringBill(p: RecurringInput, today: string): string | null {
  return recurringCharges(p, addDays(today, 1), addMonths(today, 13))[0]?.issueDate ?? null;
}

// `amount` shared over the parts by weight, always adding back exactly; all-zero weights share nothing.
export function spreadOver(amount: Paise, parts: { id: string; weight: Paise }[]): Map<string, Paise> {
  if (parts.every((p) => p.weight === 0n)) return new Map(parts.map((p) => [p.id, 0n]));
  const shares = split(amount, parts.map((p) => Number(p.weight)));
  return new Map(parts.map((p, i) => [p.id, shares[i] ?? 0n]));
}

export type LineDiscount = { name: string; reason: string; kind: "percent" | "amount"; value: number };
export type LineAmounts = { gross: Paise; discount: Paise; discountNote: string | null; net: Paise; tax: Paise };

// Full fee, then discounts (never past the fee), then tax on what's left.
export function lineAmounts(unit: Paise, quantity: number, discounts: LineDiscount[], taxBp: number): LineAmounts {
  const gross = unit * BigInt(quantity);
  const wanted = sum(discounts.map((d) => (d.kind === "percent" ? percent(gross, d.value * 100) : BigInt(d.value))));
  const discount = wanted > gross ? gross : wanted;
  const net = gross - discount;
  return { gross, discount, discountNote: discounts.length ? discounts.map((d) => `${d.name} — ${d.reason}`).join("; ") : null, net, tax: taxBp ? percent(net, taxBp) : 0n };
}

// Worked out when read (agreed 2026-09-24); no job flips the status.
export const isOverdue = (i: { status: string; dueDate: string }, today: string): boolean => (i.status === "issued" || i.status === "part_paid") && i.dueDate < today;

export function invoiceTotals(lines: Pick<LineAmounts, "gross" | "discount" | "tax">[]): { subtotal: Paise; discount: Paise; tax: Paise; total: Paise } {
  const subtotal = sum(lines.map((l) => l.gross));
  const discount = sum(lines.map((l) => l.discount));
  const tax = sum(lines.map((l) => l.tax));
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

// ---- what an invoice reads as on screen (finance spec, "Words on screen")

export const DISPLAY_STATUSES = ["draft", "due", "part_paid", "overdue", "paid", "cancelled"] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

// One word per invoice, so it sits in one tab: past its due date beats Part paid, and void reads Cancelled.
// fees/repo.ts writes this rule again as SQL for the tabs; the tab tests keep the two agreeing.
export function displayStatus(inv: Pick<Invoice, "status" | "dueDate">, today: string): DisplayStatus {
  switch (inv.status) {
    case "draft":
      return "draft";
    case "void":
      return "cancelled";
    case "paid":
      return "paid";
    case "overdue":
      return "overdue";
    case "part_paid":
      return inv.dueDate < today ? "overdue" : "part_paid";
    case "issued":
      return inv.dueDate < today ? "overdue" : "due";
  }
}

// A term plan's installments in due order: only the earliest unpaid one reads Due; later not-yet-due ones read Upcoming, past-due ones stay Overdue.
export function upcomingFlags(statuses: DisplayStatus[]): boolean[] {
  let first = true;
  return statuses.map((s) => {
    if (s !== "due" && s !== "overdue" && s !== "part_paid") return false;
    const later = !first && s === "due";
    first = false;
    return later;
  });
}

// "installment|<root>|<plan>|<i>" is the i-th installment (from 0) of one plan; `seq` names the series.
const INSTALLMENT_KEY = /^installment\|([^|]+\|[^|]+)\|(\d+)$/;
export function installmentOf(billingKey: string | null): { seq: string; index: number } | null {
  const m = billingKey ? INSTALLMENT_KEY.exec(billingKey) : null;
  return m ? { seq: m[1] ?? "", index: Number(m[2]) } : null;
}

export const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

/** Splits a term fee into equal installments, any odd paise on the earliest. */
export function splitInstallments(input: { totalPaise: Paise; count: number; everyDays: number; firstAfterDays: number }): { label: string; amountPaise: Paise; dueOffsetDays: number }[] {
  return split(input.totalPaise, input.count).map((amountPaise, i) => ({
    label: `${ordinal(i + 1)} installment`,
    amountPaise,
    dueOffsetDays: input.firstAfterDays + i * input.everyDays,
  }));
}
