import { describe, expect, it } from "vitest";
import { isMinor } from "./age";

const today = new Date("2026-09-21T10:00:00Z");

describe("isMinor", () => {
  it("is a minor before the 18th birthday and an adult from that day", () => {
    expect(isMinor("2008-09-22", today)).toBe(true);
    expect(isMinor("2008-09-21", today)).toBe(false);
    expect(isMinor("2000-01-01", today)).toBe(false);
    expect(isMinor("2015-05-05", today)).toBe(true);
  });
  it("treats a missing or bad date as a minor", () => {
    expect(isMinor(undefined, today)).toBe(true);
    expect(isMinor(null, today)).toBe(true);
    expect(isMinor("not-a-date", today)).toBe(true);
  });
});
