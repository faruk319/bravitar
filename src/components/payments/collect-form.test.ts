import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CollectScreen, DueRow, PayerOption } from "@/modules/payments/service";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, href }: { children: ReactNode; href: string }) => h("a", { href }, children) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/shell/tenant-provider", () => ({ useBranch: () => ({ branches: [{ id: "b1", name: "Main Centre" }], currentBranchId: "all", current: undefined }) }));
// The dialog's portal renders nothing on the server; the drawer's own markup is what is under test.
vi.mock("@/components/ui/sheet", async () => {
  const { createElement: h } = await import("react");
  const box = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { Sheet: box, SheetContent: box, SheetTitle: ({ children }: { children?: ReactNode }) => h("h2", null, children) };
});

const { CollectDrawer } = await import("./collect-form");

const due = (id: string, number: string, rupees: number): DueRow => ({
  id,
  number,
  dueDate: "2026-10-05",
  totalPaise: BigInt(rupees) * 100n,
  paidPaise: 0n,
  status: "issued",
  balancePaise: BigInt(rupees) * 100n,
  description: "Swimming Beginner · Oct 2026",
  students: ["Child 1"],
});
const guardian = (id: string, name: string, relation: string, open: DueRow[]): PayerOption => ({ key: `guardian:${id}`, payer: { kind: "guardian", guardianId: id }, name, relation, open, advancePaise: 0n, plans: [] });
const father = guardian("dad", "Father 1", "Father", [due("i3", "INV/2026-27/0042", 2000), due("i4", "INV/2026-27/0044", 700)]);
const mother = guardian("mum", "Mother 1", "Mother", [due("i1", "INV/2026-27/0041", 1500), due("i2", "INV/2026-27/0043", 500)]);
const screen = (over: Partial<CollectScreen> = {}): CollectScreen => ({
  memberId: "m1",
  memberName: "Child 1",
  memberCode: "BFT/2026/0001",
  branchId: "b1",
  branchName: "Main Centre",
  today: "2026-10-19",
  earliest: "2026-10-12",
  payers: [father, mother],
  defaultPayerKey: null,
  gst: false,
  enrollments: [],
  ...over,
});

const render = (s: CollectScreen, preselect: string[] = []) => renderToStaticMarkup(createElement(CollectDrawer, { screen: s, preselect, closeHref: "/finance/collections" }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
// The box in this invoice's row: true ticked, false not, undefined when the row has none.
const tickOf = (html: string, number: string) => {
  const row = html.split("<label").find((part) => part.includes(number));
  return row?.includes('type="checkbox"') ? /type="checkbox"[^>]*checked=""/.test(row) : undefined;
};
const amountOf = (html: string) => /<input[^>]*id="pay-amount"[^>]*>/.exec(html)?.[0].match(/value="([^"]*)"/)?.[1];

describe("collect drawer: who is paying", () => {
  it("with no single payer it asks who is paying, each with what they owe, and shows nothing else until one is picked", () => {
    const html = render(screen());
    const out = text(html);
    expect(out).toContain("Who is paying?");
    expect(out).toContain("Father 1 · Father Owes ₹2,700");
    expect(out).toContain("Mother 1 · Mother Owes ₹2,000");
    expect(out).not.toContain("Paying ");
    expect(out).not.toContain("What they owe");
    expect(amountOf(html)).toBeUndefined();
    expect(out).not.toContain("Record");
  });

  it("one default payer is shown as paying, with Change, their own dues ticked and the amount filled in", () => {
    const html = render(screen({ defaultPayerKey: mother.key }));
    const out = text(html);
    expect(out).toContain("Paying Mother 1 · Mother Change");
    expect(out).not.toContain("Who is paying?");
    expect([tickOf(html, "INV/2026-27/0041"), tickOf(html, "INV/2026-27/0043")]).toEqual([true, true]);
    expect(out).not.toContain("INV/2026-27/0042");
    expect(amountOf(html)).toBe("2,000");
    expect(out).toContain("Record ₹2,000");
    expect(out).toContain("What is this payment for? Fees due Advance New charge");
    expect(out).not.toContain("What for"); // the charge's fields come with New charge
  });

  it("an invoice opened from its page picks that invoice's payer over the default, with only it ticked", () => {
    const html = render(screen({ defaultPayerKey: mother.key }), ["i4"]);
    const out = text(html);
    expect(out).toContain("Paying Father 1 · Father");
    expect([tickOf(html, "INV/2026-27/0042"), tickOf(html, "INV/2026-27/0044")]).toEqual([false, true]);
    expect(out).not.toContain("INV/2026-27/0041");
    expect(amountOf(html)).toBe("700");
  });

  it("nobody owes and two guardians (no default): it asks who is paying, not the form", () => {
    const html = render(screen({ payers: [guardian("dad", "Father 1", "Father", []), guardian("mum", "Mother 1", "Mother", [])], defaultPayerKey: null }));
    const out = text(html);
    expect(out).toContain("Who is paying?");
    expect(out).toContain("Father 1 · Father Nothing due");
    expect(out).toContain("Mother 1 · Mother Nothing due");
    expect(amountOf(html)).toBeUndefined();
    expect(out).not.toContain("Record");
  });
});
