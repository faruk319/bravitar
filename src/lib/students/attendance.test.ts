import { describe, expect, it } from "vitest";
import { attendancePct } from "./attendance";

describe("attendancePct", () => {
  it("is null with no marks, never 0", () => {
    expect(attendancePct(undefined)).toBeNull();
    expect(attendancePct({ attended: 0, marked: 0 })).toBeNull();
  });
  it("is a real 0 when every marked class was missed", () => {
    expect(attendancePct({ attended: 0, marked: 4 })).toBe(0);
  });
  it("rounds to a whole percent", () => {
    expect(attendancePct({ attended: 2, marked: 3 })).toBe(67);
    expect(attendancePct({ attended: 5, marked: 5 })).toBe(100);
  });
});
