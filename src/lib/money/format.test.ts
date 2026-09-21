import { describe, expect, it } from "vitest";
import { formatCount, formatPaise } from "./format";

describe("formatPaise", () => {
  it("uses Indian grouping", () => {
    expect(formatPaise(14_250_000n)).toBe("₹1,42,500");
    expect(formatPaise(1_000_000_000n)).toBe("₹1,00,00,000");
    expect(formatPaise(150_000n)).toBe("₹1,500");
    expect(formatPaise(0n)).toBe("₹0");
  });
  it("shows paise only when present, unless asked", () => {
    expect(formatPaise(150_050n)).toBe("₹1,500.50");
    expect(formatPaise(150_005n)).toBe("₹1,500.05");
    expect(formatPaise(150_000n, { showPaise: true })).toBe("₹1,500.00");
    expect(formatPaise(150_050n, { showPaise: false })).toBe("₹1,500");
  });
  it("handles negatives", () => {
    expect(formatPaise(-150_050n)).toBe("-₹1,500.50");
  });
});

describe("formatCount", () => {
  it("groups counts the Indian way too", () => {
    expect(formatCount(142)).toBe("142");
    expect(formatCount(125_000)).toBe("1,25,000");
  });
});
