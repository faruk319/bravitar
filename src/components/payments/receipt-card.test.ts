import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Payment } from "@/modules/payments/schema";
import type { Receipt } from "@/modules/payments/service";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, ...p }: { children: React.ReactNode; href: string }) => h("a", p, children) };
});

const { ReceiptCard } = await import("./receipt-card");

const day = new Date("2026-10-05T06:00:00Z");
const payment: Payment = {
  id: "p1", tenantId: "t", branchId: "b", payerGuardianId: "g", payerMemberId: null, requestId: null, receiptNumber: "RCT/2026-27/0007", fy: "2026-27", method: "cash",
  amountPaise: 200_000n, receivedOn: "2026-10-05", recordedOn: "2026-10-05", billToName: "Mother 1", balanceAfterPaise: 100_000n, receivedBy: null, reference: null, gatewayPaymentId: null,
  notes: "Cheque to clear on Friday", status: "confirmed", cancelledAt: null, cancelledBy: null, cancelReason: null, createdAt: day,
};
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  payment,
  billToName: "Mother 1",
  collectorName: "Priya",
  lines: [{ invoiceId: "i1", number: "INV/2026-27/0042", amountPaise: 150_000n, items: [{ description: "Karate Kids", studentName: "Child 1", periodStart: "2026-10-01", periodEnd: "2026-10-31" }] }],
  students: ["Child 1"],
  advancePaise: 50_000n,
  balanceAfterPaise: 100_000n,
  academy: { name: "Bright Future", gstin: null, branch: "Main", address: null },
  ...over,
});
const render = (r: Receipt, showNotes?: boolean) => renderToStaticMarkup(createElement(ReceiptCard, { r, ...(showNotes ? { showNotes } : {}) }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("receipt card", () => {
  it("names whom it is for, and for each invoice what it was for, the month and whose", () => {
    const out = text(render(receipt()));
    expect(out).toContain("For Child 1");
    expect(out).toContain("INV/2026-27/0042");
    expect(out).toContain("Karate Kids · Oct 2026 · Child 1");
    expect(out).toContain("₹1,500");
  });

  it("a period over several months shows both ends, and an item with no period just its name", () => {
    const items = [
      { description: "Karate Annual", studentName: "Child 1", periodStart: "2026-10-01", periodEnd: "2026-12-31" },
      { description: "Admission", studentName: null, periodStart: null, periodEnd: null },
    ];
    const out = text(render(receipt({ lines: [{ invoiceId: "i1", number: "INV/2026-27/0042", amountPaise: 150_000n, items }] })));
    expect(out).toContain("Karate Annual · Oct 2026 – Dec 2026 · Child 1");
    expect(out).toContain("Admission ₹1,500");
  });

  it("an advance says what happens to it, and none shows nothing", () => {
    expect(text(render(receipt()))).toContain("Kept as advance — pays the next invoice by itself ₹500");
    expect(text(render(receipt({ advancePaise: 0n })))).not.toContain("Kept as advance");
  });

  it("the balance after shows as recorded, ₹0 included, and an older receipt leaves it out", () => {
    expect(text(render(receipt()))).toContain("Balance due after this payment ₹1,000");
    expect(text(render(receipt({ balanceAfterPaise: 0n })))).toContain("Balance due after this payment ₹0");
    expect(text(render(receipt({ balanceAfterPaise: null })))).not.toContain("Balance due");
  });

  it("with no student to name there is no For row", () => {
    expect(text(render(receipt({ students: [] })))).not.toMatch(/\bFor\b/);
  });

  it("the notes are staff's: only showNotes shows them", () => {
    expect(text(render(receipt()))).not.toContain("Cheque to clear on Friday");
    expect(text(render(receipt(), true))).toContain("Cheque to clear on Friday");
    expect(text(render(receipt({ payment: { ...payment, notes: null } }), true))).not.toContain("Notes");
  });
});
