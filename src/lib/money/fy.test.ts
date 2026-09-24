import { describe, expect, it } from "vitest";
import { financialYear } from "./fy";

describe("financialYear", () => {
  it("Indian FY runs 1 April to 31 March", () => {
    expect(financialYear("2027-03-31")).toBe("2026-27");
    expect(financialYear("2027-04-01")).toBe("2027-28");
    expect(financialYear("2027-01-15")).toBe("2026-27");
    expect(financialYear("2099-12-31")).toBe("2099-00");
  });

  it("follows the tenant's start month", () => {
    expect(financialYear("2026-06-30", 7)).toBe("2025-26");
    expect(financialYear("2026-07-01", 7)).toBe("2026-27");
    expect(financialYear("2026-12-31", 1)).toBe("2026");
  });
});
