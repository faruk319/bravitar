import { BadRequestError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { type Paise, sum } from "@/lib/money/paise";

// Pure allocation rules (docs/04 "Payment recording", docs/03 §9 agreed
// 2026-09-24). No database here.

export type Open = { invoiceId: string; balance: Paise }; // the family's open invoices, oldest first
export type Share = { invoiceId: string; amountPaise: Paise };
export type Split = { shares: Share[]; advance: Paise };

const least = (a: Paise, b: Paise): Paise => (a < b ? a : b);

// Oldest invoice first until the money runs out; what is left is advance.
export function oldestFirst(amount: Paise, open: Open[]): Split {
  const shares: Share[] = [];
  let left = amount;
  for (const o of open) {
    if (left === 0n) break;
    const take = least(o.balance, left);
    if (take > 0n) shares.push({ invoiceId: o.invoiceId, amountPaise: take });
    left -= take;
  }
  return { shares, advance: left };
}

// Invoices picked by hand: each open, each within its balance, together within
// the payment. What is left is advance, even with other invoices still open.
export function picked(amount: Paise, open: Open[], chosen: Share[]): Split {
  const order = new Map(open.map((o, i) => [o.invoiceId, i]));
  const seen = new Set<string>();
  for (const c of chosen) {
    const i = order.get(c.invoiceId);
    if (i === undefined) throw new BadRequestError("That invoice isn't open for this family");
    if (seen.has(c.invoiceId)) throw new BadRequestError("An invoice is listed twice");
    seen.add(c.invoiceId);
    if (c.amountPaise <= 0n) throw new BadRequestError("Each amount must be more than zero");
    if (c.amountPaise > (open[i]?.balance ?? 0n)) throw new BadRequestError("That's more than the invoice's balance");
  }
  const total = sum(chosen.map((c) => c.amountPaise));
  if (total > amount) throw new BadRequestError("The invoices add up to more than the payment");
  const shares = [...chosen].sort((a, b) => (order.get(a.invoiceId) ?? 0) - (order.get(b.invoiceId) ?? 0));
  return { shares, advance: amount - total };
}

export type Paid = { invoiceId: string; net: Paise }; // what one payment has on each invoice, latest due first

// Where a refund comes from: the payment's unused advance first, then its
// invoices, a picked one before the others (latest due first). Each invoice it
// comes off reopens.
export function refundFrom(amount: Paise, unused: Paise, paid: Paid[], prefer?: string): { fromAdvance: Paise; fromInvoices: Share[] } {
  const left = unused + sum(paid.map((p) => p.net));
  if (amount > left) throw new BadRequestError(`Only ${formatPaise(left)} is left on this payment`);
  const fromAdvance = least(amount, unused);
  const ordered = prefer ? [...paid.filter((p) => p.invoiceId === prefer), ...paid.filter((p) => p.invoiceId !== prefer)] : paid;
  const { shares } = oldestFirst(amount - fromAdvance, ordered.map((p) => ({ invoiceId: p.invoiceId, balance: p.net })));
  return { fromAdvance, fromInvoices: shares };
}
