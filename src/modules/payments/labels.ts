import type { Paise } from "@/lib/money/paise";
import type { Payment, PaymentMethod } from "@/modules/payments/schema";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  online: "Online",
};

// What a payment shows as on screen; the filter and the SQL behind it (payments/repo.ts) agree with paymentDisplay().
export const PAYMENT_DISPLAYS = ["received", "part_refunded", "refunded", "cancelled"] as const;
export type PaymentDisplay = (typeof PAYMENT_DISPLAYS)[number];

export const DISPLAY_LABEL: Record<PaymentDisplay, string> = { received: "Received", part_refunded: "Part refunded", refunded: "Refunded", cancelled: "Cancelled" };

export function paymentDisplay(p: { status: Payment["status"]; amountPaise: Paise }, refundedPaise: Paise): PaymentDisplay {
  if (p.status === "cancelled") return "cancelled";
  if (p.status === "refunded" || (refundedPaise > 0n && refundedPaise >= p.amountPaise)) return "refunded";
  return refundedPaise > 0n ? "part_refunded" : "received";
}
