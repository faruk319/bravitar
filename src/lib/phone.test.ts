import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, phoneSchema } from "./phone";

describe("normalizePhone", () => {
  it("accepts the ways Indian numbers get written", () => {
    for (const v of ["9876543210", "98765 43210", "098765-43210", "+91 98765 43210", "+919876543210", "0091 9876543210", "91-9876543210"]) {
      expect(normalizePhone(v), v).toBe("+919876543210");
    }
  });
  it("refuses anything that is not a 10-digit mobile", () => {
    for (const v of ["12345", "1234567890", "+1 555 123 4567", "", "98765"]) expect(normalizePhone(v), v).toBeUndefined();
  });
  it("schema gives a plain message", () => {
    expect(phoneSchema.parse("98765 43210")).toBe("+919876543210");
    expect(() => phoneSchema.parse("12")).toThrow(/10-digit/);
  });
  it("formats for display", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
  });
});
