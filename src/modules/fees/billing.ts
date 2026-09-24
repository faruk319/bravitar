import { addDays } from "@/lib/dates";
import { type Paise, percent, roundHalfUp, sum } from "@/lib/money/paise";

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
