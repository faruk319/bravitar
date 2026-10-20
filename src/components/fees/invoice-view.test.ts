import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LineRow } from "@/modules/fees/repo";
import type { InvoiceDetail, InvoiceView } from "@/modules/fees/service";
import type { MoneyRow } from "@/modules/payments/repo";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, ...p }: { children: React.ReactNode; href: string }) => h("a", p, children) };
});

const { InvoiceFacts, InvoiceLines, MoneyHistory } = await import("./invoice-view");

const when = new Date("2026-10-01T00:00:00Z");
const invoice = (over: Partial<InvoiceView["invoice"]> = {}): InvoiceView["invoice"] => ({
  id: "i1", tenantId: "t", branchId: "b", studentId: "s", payerGuardianId: null, payerMemberId: null, billToName: "Mother Mehta", number: "INV/2026-27/0007", fy: "2026-27",
  periodStart: "2026-10-01", periodEnd: "2026-10-31", issueDate: "2026-10-01", dueDate: "2026-10-08", subtotalPaise: 150000n, discountPaise: 0n, taxPaise: 0n,
  totalPaise: 150000n, paidPaise: 0n, status: "issued", voidReason: null, issuedAt: when, createdAt: when, createdBy: null, issuedBy: null, ...over,
});
const line: LineRow = {
  id: "l1", tenantId: "t", invoiceId: "i1", enrollmentId: "e1", studentId: "s", feePlanId: "p", kind: "tuition", description: "Karate Monthly", periodStart: "2026-10-01", periodEnd: "2026-10-31",
  quantity: 1, unitPaise: 150000n, discountPaise: 0n, discountNote: null, taxPaise: 0n, amountPaise: 150000n, billingKey: null, studentName: "Riya Mehta",
};
const view = (over: Partial<InvoiceView["invoice"]> = {}): InvoiceView => ({
  invoice: invoice(over), display: "due", overdue: false, billToName: "Mother Mehta", lines: [line], academy: { name: "Bright Future", gstin: null, branch: "Main", address: null },
});
const staff = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  ...view(),
  programs: [{ enrollmentId: "e1", programName: "Karate", batchName: "Karate A", planName: "Karate Monthly" }],
  createdByName: null,
  issuedByName: null,
  ...over,
});
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/ ,/g, ","); // a tag is a space, except before a comma

describe("an invoice's totals", () => {
  it("shows Total, Paid and Balance once something is paid, and only Total before", () => {
    const part = text(renderToStaticMarkup(createElement(InvoiceLines, { d: view({ paidPaise: 50000n, status: "part_paid" }) })));
    expect(part).toContain("Total ₹1,500 Paid ₹500 Balance ₹1,000");
    const unpaid = text(renderToStaticMarkup(createElement(InvoiceLines, { d: view() })));
    expect(unpaid).toContain("Total ₹1,500");
    expect(unpaid).not.toMatch(/Paid|Balance/);
  });
});

describe("an invoice's facts", () => {
  const render = (d: Parameters<typeof InvoiceFacts>[0]["d"]) => text(renderToStaticMarkup(createElement(InvoiceFacts, { d })));

  it("staff see the student, each program with its batch and fee plan, and who created and issued it", () => {
    const out = render(
      staff({
        programs: [
          { enrollmentId: "e1", programName: "Karate", batchName: "Karate A", planName: "Karate Monthly" },
          { enrollmentId: "e2", programName: "Swimming", batchName: "Swim B", planName: null },
        ],
        createdByName: "Priya",
        issuedByName: "Amit",
      }),
    );
    for (const bit of ["Student Riya Mehta", "Bill to Mother Mehta", "Programs Karate · Karate A Karate Monthly Swimming · Swim B", "Issued 1 Oct 2026", "Due 8 Oct 2026", "Period", "Created by Priya", "Issued by Amit"]) {
      expect(out, bit).toContain(bit);
    }
    expect(out).not.toContain("Swim B Karate"); // no plan name invented for a line without a plan
  });

  it("a row for a person appears only when someone is known; the nightly run has no one", () => {
    const out = render(staff({ createdByName: null, issuedByName: "Amit" }));
    expect(out).toContain("Issued by Amit");
    expect(out).not.toContain("Created by");
    expect(render(staff())).not.toMatch(/Created by|Issued by/);
  });

  it("the family's link gets the plain facts and never the staff's", () => {
    const out = render(view());
    for (const bit of ["Bill to Mother Mehta", "Issued 1 Oct 2026", "Due 8 Oct 2026"]) expect(out, bit).toContain(bit);
    expect(out).not.toMatch(/Student|Program|Created by|Issued by/);
  });

  it("says Planned for on a draft and gives the cancel reason, never 'Void'", () => {
    expect(render(staff({ invoice: invoice({ status: "draft", number: null }) }))).toContain("Planned for 1 Oct 2026");
    const out = render(staff({ invoice: invoice({ status: "void", voidReason: "Wrong fee plan" }) }));
    expect(out).toContain("Cancel reason Wrong fee plan");
    expect(out).not.toMatch(/Void/i);
  });

  it("names the students when an invoice has several, once each", () => {
    const two: LineRow[] = [line, { ...line, id: "l2", studentName: "Kabir Mehta" }, { ...line, id: "l3", studentName: "Riya Mehta" }];
    expect(render(staff({ lines: two }))).toContain("Students Riya Mehta, Kabir Mehta");
  });
});

describe("the money history", () => {
  const row = (over: Partial<MoneyRow> = {}): MoneyRow => ({
    kind: "receipt", amountPaise: 80000n, at: new Date("2026-10-02T04:00:00Z"), paymentId: "p1", receiptNumber: "RCT/2026-27/0007", receivedOn: "2026-10-02", method: "upi", reason: null, ...over,
  });
  const render = (rows: MoneyRow[], extra: { timeZone?: string; receiptHref?: (id: string) => string } = {}) =>
    renderToStaticMarkup(createElement(MoneyHistory, { rows, timeZone: extra.timeZone ?? "Asia/Kolkata", ...(extra.receiptHref ? { receiptHref: extra.receiptHref } : {}) }));

  it("is not there when no money has moved", () => {
    expect(render([])).toBe("");
  });

  it("says what each movement was, with the receipt, the day it came in and how, and the amount", () => {
    const out = text(render([row(), row({ kind: "advance", amountPaise: 150000n, receivedOn: "2026-09-26", method: "cash" })]));
    expect(out).toContain("Paid RCT/2026-27/0007, received 2 Oct 2026, UPI ₹800");
    expect(out).toContain("From advance RCT/2026-27/0007, received 26 Sept 2026, Cash ₹1,500");
  });

  it("shows money taken back as negative, with the reason", () => {
    const out = text(
      render([
        row({ kind: "refund", amountPaise: -50000n, reason: "Missed classes" }),
        row({ kind: "void", amountPaise: -30000n, reason: "Wrong fee plan" }),
        row({ kind: "cancel", amountPaise: -20000n }),
      ]),
    );
    expect(out).toContain("Refunded RCT/2026-27/0007, received 2 Oct 2026, UPI · Missed classes -₹500");
    expect(out).toContain("Released to advance RCT/2026-27/0007, received 2 Oct 2026, UPI · Wrong fee plan -₹300");
    expect(out).toContain("Payment cancelled RCT/2026-27/0007, received 2 Oct 2026, UPI -₹200");
  });

  it("keeps the order it is given", () => {
    const out = text(render([row({ kind: "receipt" }), row({ kind: "refund", amountPaise: -1000n, reason: "r" })]));
    expect(out.indexOf("Paid")).toBeLessThan(out.indexOf("Refunded"));
  });

  it("links the receipt number only when the viewer may open receipts", () => {
    const linked = render([row()], { receiptHref: (id) => `/finance/collections/${id}` });
    expect(linked).toMatch(/<a [^>]*href="\/finance\/collections\/p1"[^>]*>RCT\/2026-27\/0007<\/a>/);
    expect(render([row()])).not.toContain("<a ");
    expect(text(render([row()]))).toContain("RCT/2026-27/0007");
  });

  it("dates a movement by the academy's day, not the server's", () => {
    // 20:00 UTC on 2 Oct is 01:30 on 3 Oct in India.
    const late = row({ at: new Date("2026-10-02T20:00:00Z") });
    expect(text(render([late], { timeZone: "Asia/Kolkata" }))).toMatch(/₹800 3 Oct 2026/);
    expect(text(render([late], { timeZone: "UTC" }))).toMatch(/₹800 2 Oct 2026/);
  });
});
