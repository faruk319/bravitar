import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InvoiceRow } from "@/modules/fees/repo";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, ...p }: { children: React.ReactNode; href: string }) => h("a", p, children) };
});

const { InvoiceTable } = await import("./invoice-table");

const when = new Date("2026-10-01T00:00:00Z");
const inv = (id: string, over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id, tenantId: "t", branchId: "b", studentId: "s", payerGuardianId: null, payerMemberId: null, billToName: "Mother Mehta", number: `INV-${id}`, fy: "2026-27",
  periodStart: "2026-10-01", periodEnd: "2026-10-31", issueDate: "2026-10-01", dueDate: "2026-10-08", subtotalPaise: 150000n, discountPaise: 0n, taxPaise: 0n,
  totalPaise: 150000n, paidPaise: 0n, status: "issued", voidReason: null, issuedAt: when, createdAt: when, createdBy: null, issuedBy: null, students: ["Riya Mehta"], display: "due", programs: ["Karate"], installment: null, ...over,
});
// The table (md and up) and the cards (below md) are two renderings of the same rows.
const render = (rows: InvoiceRow[]) => renderToStaticMarkup(createElement(InvoiceTable, { rows }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const table = (html: string) => /<table[\s\S]*<\/table>/.exec(html)?.[0] ?? "";
const cards = (html: string) => /<ul[\s\S]*<\/ul>/.exec(html)?.[0] ?? "";

describe("invoice table", () => {
  it("a row says what, for whom, how much and how it stands", () => {
    const html = render([inv("1", { paidPaise: 50000n, status: "part_paid", display: "part_paid" })]);
    for (const part of [table(html), cards(html)]) {
      const out = text(part);
      for (const bit of ["INV-1", "Riya Mehta", "Mother Mehta", "Karate", "Oct 2026", "₹1,500", "₹500", "₹1,000", "8 Oct 2026", "Part paid"]) expect(out, bit).toContain(bit);
    }
    expect(text(table(html))).toContain("1 Oct 2026"); // under the number
  });

  it("every row opens its invoice, the table and the cards alike", () => {
    const html = render([inv("a"), inv("b")]);
    expect(table(html).match(/href="\/finance\/invoices\/[ab]"/g)).toHaveLength(2);
    expect(cards(html).match(/href="\/finance\/invoices\/[ab]"/g)).toHaveLength(2);
  });

  it("a table from md up and cards below it, never both on one screen", () => {
    const html = render([inv("1")]);
    expect(html).toMatch(/<div class="hidden overflow-x-auto md:block"><table/); // the table scrolls inside its card rather than being clipped
    expect(html).toMatch(/<ul class="md:hidden">/);
  });

  it("the first program, and how many more", () => {
    const out = text(table(render([inv("1", { programs: ["Dance", "Karate"] }), inv("2", { programs: ["Dance", "Karate", "Swimming"] })])));
    expect(out).toContain("Dance +1");
    expect(out).toContain("Dance +2");
  });

  it("an installment says where it sits in its plan, in place of a period", () => {
    const out = text(table(render([inv("1", { periodStart: null, periodEnd: null, installment: { n: 2, of: 4, seq: "s" } })])));
    expect(out).toContain("Karate Installment 2 of 4 ₹1,500");
    // Positive control: a monthly fee shows its month in that place.
    expect(text(table(render([inv("1")])))).toContain("Karate Oct 2026 ₹1,500");
  });

  it("a plan with one installment shows no position", () => {
    const out = text(table(render([inv("1", { periodStart: null, periodEnd: null, installment: { n: 1, of: 1, seq: "s" } })])));
    expect(out).not.toContain("Installment");
    expect(out).toContain("Karate — ₹1,500");
  });

  it("a draft is named Draft, a cancelled invoice owes nothing, a paid one has a ₹0 balance", () => {
    const rows = [
      inv("1", { number: null, status: "draft", display: "draft", billToName: "Draft Payer" }),
      inv("2", { status: "void", display: "cancelled", billToName: "Void Payer" }),
      inv("3", { status: "paid", display: "paid", paidPaise: 150000n, billToName: "Paid Payer" }),
    ];
    const [draft, voided, paid] = (render(rows).match(/<tr[\s\S]*?<\/tr>/g) ?? []).slice(1).map(text);
    expect(draft).toContain("Draft 1 Oct 2026");
    expect(draft).not.toContain("INV-");
    expect(draft).toContain("₹1,500 — —"); // the total, then no paid and no balance
    expect(voided).toContain("Cancelled");
    expect(voided).toContain("₹1,500 — —");
    expect(paid).toContain("₹1,500 ₹1,500 ₹0");
  });
});
