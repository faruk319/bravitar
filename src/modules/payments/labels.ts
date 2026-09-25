import type { PaymentMethod } from "@/modules/payments/schema";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  online: "Online",
};
