import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CreateScreen, EditSeed } from "@/modules/fees/service";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, href }: { children: ReactNode; href: string }) => h("a", { href }, children) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/shell/tenant-provider", () => ({ useBranch: () => ({ branches: [{ id: "b1", name: "Main Centre" }], currentBranchId: "all", current: undefined }) }));
// The dialog's portal renders nothing on the server; the sheet's own markup is what is under test.
vi.mock("@/components/ui/sheet", async () => {
  const { createElement: h } = await import("react");
  const box = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { Sheet: box, SheetContent: box, SheetTitle: ({ children }: { children?: ReactNode }) => h("h2", null, children) };
});

const { CreateInvoiceSheet } = await import("./create-invoice");

const mother = { key: "guardian:mum", payer: { kind: "guardian", guardianId: "mum" }, name: "Mother 1", relation: "Mother" } as const;
const father = { key: "guardian:dad", payer: { kind: "guardian", guardianId: "dad" }, name: "Father 1", relation: "Father" } as const;
const screen = (over: Partial<CreateScreen> = {}): CreateScreen => ({
  student: { id: "s1", name: "Child 1", code: "BFT/2026/0001", branchId: "b1" },
  payers: [mother, father],
  defaultPayerKey: mother.key,
  enrollments: [
    { id: "e1", programId: "p1", programName: "Karate", batchName: "Beginners B", payerKey: mother.key },
    { id: "e2", programId: "p2", programName: "Dance", batchName: "Teens A", payerKey: father.key },
  ],
  gst: false,
  admissionBilled: {},
  ...over,
});
const line = (over: Partial<EditSeed["lines"][number]> = {}): EditSeed["lines"][number] => ({ kind: "item", description: "Uniform", amountPaise: "120000", enrollmentId: "e1", taxRateBp: 0, ...over });
// The draft is billed to the father, though the program on its first line would bring the mother.
const seedOf = (lines = [line(), line({ kind: "other", description: "Photos", amountPaise: "50000", enrollmentId: null })]): EditSeed => ({ id: "inv1", payerKey: father.key, dueDate: "2026-11-02", lines });

const render = (s: CreateScreen, seed?: EditSeed) => renderToStaticMarkup(createElement(CreateInvoiceSheet, { screen: s, ...(seed ? { seed } : {}), today: "2026-10-20", closeHref: "/finance/invoices" }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const valueOf = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0].match(/value="([^"]*)"/)?.[1];
// The kind pill pressed on each line, and the option chosen in each program select.
const pressed = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)<\/button>/g)].map((m) => (m[1] ?? "").replace(/&amp;/g, "&"));
const chosen = (html: string) => [...html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].filter((m) => /\bselected\b/.test(m[1] ?? "")).map((m) => m[2]);

describe("create invoice sheet", () => {
  it("editing comes up with the draft's payer, lines and due date filled in", () => {
    const html = render(screen(), seedOf());
    const out = text(html);
    expect(out).toContain("Edit invoice");
    expect(out).toContain("Child 1 BFT/2026/0001");
    expect(out).toContain("Bill to Father 1 · Father Change");
    expect(pressed(html)).toEqual(["Uniform & kit", "Other"]);
    expect([valueOf(html, "charge-what-0"), valueOf(html, "charge-amount-0")]).toEqual(["Uniform", "1,200"]);
    expect([valueOf(html, "charge-what-1"), valueOf(html, "charge-amount-1")]).toEqual(["Photos", "500"]);
    expect(chosen(html)).toEqual(["Karate · Beginners B", "No program"]);
    expect(valueOf(html, "charge-due")).toBe("2026-11-02"); // the draft's own, not a week from today
    expect(out).toContain("Save changes");
    expect(out).not.toContain("Create and issue");
    expect(out).not.toContain("Another student");
  });

  it("has no tax field without GST; with GST each line shows its rate", () => {
    const plain = render(screen(), seedOf([line({ taxRateBp: 1800 })]));
    expect(plain).not.toContain("charge-tax-");
    expect(text(plain)).not.toContain("Tax %");
    const taxed = render(screen({ gst: true }), seedOf([line({ taxRateBp: 1800 }), line({ taxRateBp: 950 }), line({ taxRateBp: 0 })]));
    expect([0, 1, 2].map((n) => valueOf(taxed, `charge-tax-${n}`))).toEqual(["18", "9.5", ""]);
  });

  it("creating starts with one blank Other line, the default payer and a due date a week out", () => {
    const html = render(screen());
    const out = text(html);
    expect(out).toContain("Create invoice");
    expect(out).toContain("Bill to Mother 1 · Mother Change");
    expect(pressed(html)).toEqual(["Other"]);
    expect([valueOf(html, "charge-what-0"), valueOf(html, "charge-amount-0")]).toEqual(["", ""]);
    expect(valueOf(html, "charge-due")).toBe("2026-10-27");
    expect(out).toContain("Another student");
    expect(out).toContain("Create and issue");
    expect(out).toContain("Save as draft");
  });
});
