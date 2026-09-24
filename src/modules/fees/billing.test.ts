import { describe, expect, it } from "vitest";
import { addMonths, cycleContaining, invoiceTotals, lineAmounts, recurringCharges } from "./billing";

const plan = { cycle: "monthly" as const, billingDay: 1, amount: 80000n, proration: "full" as const };

describe("cycles", () => {
  it("adds months on a day that always exists (billing day ≤ 28)", () => {
    expect(addMonths("2026-11-28", 3)).toBe("2027-02-28");
    expect(addMonths("2026-01-05", -2)).toBe("2025-11-05");
  });

  it("finds the cycle a date falls in, anchored on the join month", () => {
    expect(cycleContaining("2026-09-15", "monthly", 1, "2026-09-15")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(cycleContaining("2026-09-10", "quarterly", 5, "2026-09-10")).toEqual({ start: "2026-09-05", end: "2026-12-04" });
    expect(cycleContaining("2026-09-03", "quarterly", 5, "2026-09-03")).toEqual({ start: "2026-06-05", end: "2026-09-04" });
    expect(cycleContaining("2026-09-10", "quarterly", 5, "2027-01-20")).toEqual({ start: "2026-12-05", end: "2027-03-04" });
  });
});

describe("recurringCharges", () => {
  const base = { ...plan, anchor: "2026-09-15", start: "2026-09-15", end: null, pausedOn: null, continuing: false };

  it("mid-month joiner pays the full month by default, billed on the join day; then each cycle start", () => {
    expect(recurringCharges(base, "2026-09-15", "2026-11-01")).toEqual([
      { period: { start: "2026-09-15", end: "2026-09-30" }, issueDate: "2026-09-15", amount: 80000n, prorated: false },
      { period: { start: "2026-10-01", end: "2026-10-31" }, issueDate: "2026-10-01", amount: 80000n, prorated: false },
      { period: { start: "2026-11-01", end: "2026-11-30" }, issueDate: "2026-11-01", amount: 80000n, prorated: false },
    ]);
  });

  it("'By days' charges only the days left: 16 of 30 days of ₹800 = ₹426.67", () => {
    const [first] = recurringCharges({ ...base, proration: "daily" }, "2026-09-15", "2026-09-15");
    expect([first?.amount, first?.prorated]).toEqual([42667n, true]);
  });

  it("only charges whose billing day falls in the window", () => {
    expect(recurringCharges(base, "2026-10-02", "2026-10-31")).toEqual([]);
    expect(recurringCharges(base, "2026-10-01", "2026-10-01").map((c) => c.issueDate)).toEqual(["2026-10-01"]);
  });

  it("pause stops billing from the pause date; the last day stops later cycles", () => {
    expect(recurringCharges({ ...base, pausedOn: "2026-10-10" }, "2026-09-15", "2026-12-31").map((c) => c.issueDate)).toEqual(["2026-09-15", "2026-10-01"]);
    expect(recurringCharges({ ...base, end: "2026-10-20" }, "2026-09-15", "2026-12-31").map((c) => c.issueDate)).toEqual(["2026-09-15", "2026-10-01"]);
    expect(recurringCharges({ ...base, end: "2026-09-14" }, "2026-09-01", "2026-12-31")).toEqual([]); // left before joining
  });

  it("a batch move continues the old chain: the partial cycle stands, the new fee starts next cycle", () => {
    const moved = { ...base, amount: 100000n, anchor: "2026-06-01", start: "2026-10-15", continuing: true };
    expect(recurringCharges(moved, "2026-10-15", "2026-11-30").map((c) => [c.issueDate, c.amount])).toEqual([["2026-11-01", 100000n]]);
  });

  it("quarterly from the join month", () => {
    const q = { ...base, cycle: "quarterly" as const, billingDay: 5, anchor: "2026-09-10", start: "2026-09-10", amount: 240000n };
    expect(recurringCharges(q, "2026-09-10", "2027-06-30").map((c) => [c.issueDate, c.period.end])).toEqual([
      ["2026-09-10", "2026-12-04"],
      ["2026-12-05", "2027-03-04"],
      ["2027-03-05", "2027-06-04"],
      ["2027-06-05", "2027-09-04"],
    ]);
  });
});

describe("line money", () => {
  it("full fee, then discount, then tax on what's left, half up per line", () => {
    const sibling = { name: "Sibling 10%", reason: "second child", kind: "percent" as const, value: 10 };
    expect(lineAmounts(80000n, 1, [sibling], 1800)).toEqual({ gross: 80000n, discount: 8000n, discountNote: "Sibling 10% — second child", net: 72000n, tax: 12960n });
    expect(lineAmounts(83333n, 1, [], 1800)).toMatchObject({ net: 83333n, tax: 15000n });
  });

  it("discounts never go past the fee; no GST means no tax", () => {
    const waiver = { name: "Scholarship", reason: "full waiver", kind: "amount" as const, value: 100000 };
    expect(lineAmounts(80000n, 1, [waiver], 0)).toEqual({ gross: 80000n, discount: 80000n, discountNote: "Scholarship — full waiver", net: 0n, tax: 0n });
  });

  it("invoice totals reconcile: lines − discount + tax", () => {
    const a = lineAmounts(80000n, 1, [], 1800);
    const b = lineAmounts(150000n, 1, [{ name: "Sibling", reason: "2nd", kind: "percent", value: 15 }], 1800);
    const t = invoiceTotals([a, b]);
    expect(t).toEqual({ subtotal: 230000n, discount: 22500n, tax: 14400n + 22950n, total: 230000n - 22500n + 37350n });
  });
});
