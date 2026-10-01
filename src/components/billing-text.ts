import { formatDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money/format";
import { type ActivityPlan, type ActivitySubscription, BILLING_INTERVALS, type BillingInterval, type BillingPayment } from "@/modules/billing/schema";

// How Bravitar's prices, bills and subscriptions are worded, on /platform and on the academy's Billing page.

// "₹300/month", "₹3,000/year".
export const perCycle = (paise: bigint, interval: BillingInterval): string => `${formatPaise(paise)}/${interval}`;

// "₹600/month + ₹5,000/year": the cycles in use, or "₹0/month".
export function totalsText(totals: Record<BillingInterval, bigint>): string {
  const parts = BILLING_INTERVALS.filter((i) => totals[i] > 0n).map((i) => perCycle(totals[i], i));
  return parts.length ? parts.join(" + ") : perCycle(0n, "month");
}

export const METHOD_LABEL: Record<BillingPayment["method"], string> = { upi: "UPI", bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque" };

// For plan pickers: "Starter · ₹300/month (not offered)".
export const planLabel = (p: Pick<ActivityPlan, "name" | "pricePaise" | "billingInterval" | "isOffered">): string =>
  `${p.name} · ${perCycle(p.pricePaise, p.billingInterval)}${p.isOffered ? "" : " (not offered)"}`;

// For owners: "Growth · ₹600/month · 200 students · 5 staff".
export const planChoice = (p: Pick<ActivityPlan, "name" | "pricePaise" | "billingInterval" | "maxStudents" | "maxStaff">): string =>
  `${p.name} · ${perCycle(p.pricePaise, p.billingInterval)} · ${p.maxStudents ?? "Any"} students · ${p.maxStaff ?? "Any"} staff`;

// Free use or a special price while it lasts: "Free until 31 Dec 2026 · Pilot".
export function priceNote(s: Pick<ActivitySubscription, "overridePaise" | "overrideUntil" | "overrideReason" | "billingInterval">, today: string): string | null {
  if (s.overridePaise === null || (s.overrideUntil !== null && today > s.overrideUntil)) return null;
  const price = s.overridePaise === 0n ? "Free" : perCycle(s.overridePaise, s.billingInterval);
  return `${price}${s.overrideUntil ? ` until ${formatDate(s.overrideUntil)}` : ""}${s.overrideReason ? ` · ${s.overrideReason}` : ""}`;
}

export function subscriptionState(s: Pick<ActivitySubscription, "status" | "periodEnd" | "cancelAtPeriodEnd">): string {
  const when = formatDate(s.periodEnd);
  if (s.status === "cancelled") return `Ended ${when}`;
  if (s.status === "pending") return "Waiting for payment";
  if (s.cancelAtPeriodEnd) return `${s.status === "paused" ? "Paused · ends" : "Ends"} ${when}`;
  if (s.status === "trial") return `Trial until ${when}`;
  return s.status === "paused" ? "Paused" : `Next bill ${when}`;
}
