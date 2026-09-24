import { describe, expect, it } from "vitest";
import { add, parseRupees, percent, roundHalfUp, split, subtract, sum } from "./paise";

describe("docs/04 pinned cases", () => {
  it("₹1,500 split across 3 children is ₹500 each", () => {
    expect(split(150000n, 3)).toEqual([50000n, 50000n, 50000n]);
  });

  it("18% tax on ₹833.33 is ₹150.00 (14,999.94 paise rounds half up)", () => {
    expect(percent(83333n, 1800)).toBe(15000n);
  });
});

describe("split", () => {
  it("always adds back to the total; leftover paise go to the first parts", () => {
    expect(split(100000n, 3)).toEqual([33334n, 33333n, 33333n]);
    expect(sum(split(100000n, 3))).toBe(100000n);
    expect(split(1n, 3)).toEqual([1n, 0n, 0n]);
  });

  it("by weights, largest remainder first", () => {
    expect(split(100000n, [2, 1])).toEqual([66667n, 33333n]);
    expect(split(1000n, [1, 1, 2])).toEqual([250n, 250n, 500n]);
  });

  it("refuses nonsense", () => {
    expect(() => split(100n, 0)).toThrow();
    expect(() => split(100n, [0, 0])).toThrow();
    expect(() => split(-100n, 2)).toThrow();
  });
});

describe("rounding and arithmetic", () => {
  it("rounds half up, away from zero on both signs", () => {
    expect(roundHalfUp(5n, 10n)).toBe(1n);
    expect(roundHalfUp(4n, 10n)).toBe(0n);
    expect(roundHalfUp(-5n, 10n)).toBe(-1n);
    expect(roundHalfUp(-4n, 10n)).toBe(0n);
    expect(roundHalfUp(15n, 10n)).toBe(2n);
  });

  it("percent in basis points: 10% sibling discount, 0%, 100%", () => {
    expect(percent(80000n, 1000)).toBe(8000n);
    expect(percent(80000n, 0)).toBe(0n);
    expect(percent(80000n, 10000)).toBe(80000n);
    expect(percent(33333n, 1500)).toBe(5000n); // 4,999.95 → 5,000
  });

  it("adds, subtracts and sums in paise", () => {
    expect(add(150000n, 80000n, 1n)).toBe(230001n);
    expect(subtract(150000n, 80000n)).toBe(70000n);
    expect(sum([])).toBe(0n);
  });
});

describe("parseRupees (form input only)", () => {
  it("reads what people type", () => {
    expect(parseRupees("1,500")).toBe(150000n);
    expect(parseRupees("1500.5")).toBe(150050n);
    expect(parseRupees("₹ 800")).toBe(80000n);
    expect(parseRupees("1,42,500.05")).toBe(14250005n);
  });

  it("rejects what isn't money", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1..2", "12,34x"]) expect(parseRupees(bad)).toBeUndefined();
  });
});
