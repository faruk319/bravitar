import { InvoiceStatus } from "@/components/fees/invoice-status";
import { formatDayMonth } from "@/lib/dates";
import type { BillingInvoice } from "@/modules/billing/schema";

// A Bravitar bill's state: Paid, Void, Overdue, Part paid, or when it's due.
export function BillStatus({ bill, today }: { bill: Pick<BillingInvoice, "status" | "dueOn" | "paidPaise">; today: string }) {
  if (bill.status === "void") return <InvoiceStatus status="void" />;
  if (bill.status === "paid") return <InvoiceStatus status="paid" />;
  if (today > bill.dueOn) return <InvoiceStatus status="issued" overdue />;
  if (bill.paidPaise > 0n) return <InvoiceStatus status="part_paid" />;
  return <span className="text-caption text-muted-foreground">Due {formatDayMonth(bill.dueOn)}</span>;
}
