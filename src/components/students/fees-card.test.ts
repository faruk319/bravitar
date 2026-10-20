import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { displayStatus } from "@/modules/fees/billing";
import type { InvoiceRow } from "@/modules/fees/repo";
import type { StudentProfile } from "@/modules/students/profile";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, ...p }: { children: React.ReactNode; href: string }) => h("a", p, children) };
});

const { FeesCard } = await import("./fees-card");
type Fees = NonNullable<StudentProfile["fees"]>;

const when = new Date("2026-10-01T00:00:00Z");
const inv = (id: string, billToName: string, totalPaise: bigint, over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id, tenantId: "t", branchId: "b", studentId: "s", payerGuardianId: null, payerMemberId: null, billToName, number: `INV-${id}`, fy: "2026-27",
  periodStart: "2026-10-01", periodEnd: "2026-10-31", issueDate: "2026-10-01", dueDate: "2026-10-08", subtotalPaise: totalPaise, discountPaise: 0n, taxPaise: 0n,
  totalPaise, paidPaise: 0n, status: "issued", voidReason: null, issuedAt: when, createdAt: when, createdBy: null, issuedBy: null, students: [], display: "due", programs: [], installment: null, ...over,
});
const paidInv = (id: string, billToName: string, totalPaise: bigint, over: Partial<InvoiceRow> = {}) => inv(id, billToName, totalPaise, { paidPaise: totalPaise, status: "paid", display: "paid", ...over });
const render = (fees: Omit<Fees, "discounts">, nextDue: string | null = null) => renderToStaticMarkup(createElement(FeesCard, { fees: { ...fees, discounts: [] }, nextDue, plans: ["Karate Monthly"] }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("fees card", () => {
  it("two payers: two invoices, each under its own name and amount, and no combined total", () => {
    const out = text(render({ today: "2026-10-10", invoices: [inv("1", "Mother Mehta", 80000n), paidInv("2", "Aunt Mehta", 100000n)], receipts: [] }));
    expect(out).toContain("Mother Mehta");
    expect(out).toContain("Aunt Mehta");
    expect(out).toContain("₹800");
    expect(out).toContain("₹1,000");
    expect(out).not.toContain("₹1,800");
    expect(out).toContain("Owes ₹800"); // the unpaid one owes, the paid one does not
    expect(out.match(/Owes/g)).toHaveLength(1);
  });

  it("an unpaid invoice past its due date reads Overdue, in words", () => {
    const unpaid = (today: string) => inv("1", "Mother Mehta", 80000n, { display: displayStatus({ status: "issued", dueDate: "2026-10-08" }, today) });
    expect(text(render({ today: "2026-10-10", invoices: [unpaid("2026-10-10")], receipts: [] }))).toContain("Overdue");
    // Positive control: before the due date it is just due.
    const before = text(render({ today: "2026-10-05", invoices: [unpaid("2026-10-05")], receipts: [] }));
    expect(before).not.toContain("Overdue");
    expect(before).toContain("Due");
  });

  it("each invoice reads in the six words of the invoice list", () => {
    const rows = [inv("1", "A", 100n, { display: "draft" }), inv("2", "B", 100n), inv("3", "C", 100n, { display: "part_paid" }), inv("4", "D", 100n, { display: "overdue" }), paidInv("5", "E", 100n), inv("6", "F", 100n, { display: "cancelled" })];
    const out = text(render({ today: "2026-10-10", invoices: rows, receipts: [] }));
    for (const word of ["Draft", "Due", "Part paid", "Overdue", "Paid", "Cancelled"]) expect(out).toContain(word);
    expect(out).not.toContain("Unpaid");
    expect(out).not.toContain("Void");
  });

  it("nothing billed and no payments read as empty, with dashes for the facts", () => {
    const out = text(render({ today: "2026-10-10", invoices: [], receipts: [] }));
    expect(out).toContain("Nothing billed.");
    expect(out).toContain("No payments yet.");
    expect(out).toContain("Last payment —");
  });

  it("a payment shows date, amount, method and who it paid for", () => {
    const out = text(render({ today: "2026-10-10", invoices: [paidInv("2", "Aunt Mehta", 100000n)], receipts: [{ paymentId: "p", invoiceId: "2", receiptNumber: "R-1", receivedOn: "2026-10-03", method: "upi", net: 100000n }] }));
    expect(out).toContain("UPI · Aunt Mehta");
    expect(out).toContain("3 Oct 2026");
    expect(out).toContain("Last payment ₹1,000");
  });

  it("an earlier unpaid invoice is listed apart from this month's", () => {
    const out = text(render({ today: "2026-10-10", invoices: [inv("3", "Mother Mehta", 80000n, { issueDate: "2026-09-01", dueDate: "2026-09-08" })], receipts: [] }));
    expect(out).toContain("Nothing billed.");
    expect(out).toContain("Earlier, unpaid");
  });

  it("paid invoices from earlier months sit under one disclosure, not in the open", () => {
    const paid = paidInv("4", "Aunt Mehta", 100000n, { issueDate: "2026-08-01", dueDate: "2026-08-08" });
    const out = text(render({ today: "2026-10-10", invoices: [paid], receipts: [] }));
    expect(out).toContain("Earlier invoices · 1");
    expect(out).toContain("INV-4");
    expect(out).not.toContain("View all");
    // Positive control: with only this month's invoice there is no disclosure.
    expect(text(render({ today: "2026-10-10", invoices: [inv("1", "Mother Mehta", 80000n)], receipts: [] }))).not.toContain("Earlier invoices");
  });
});
