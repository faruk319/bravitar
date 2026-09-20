import { describe, expect, it } from "vitest";
import { z } from "zod";
import { uuidv7, uuidv7Time } from "./ids";

describe("uuidv7", () => {
  it("is a canonical uuid with version 7 and RFC variant", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(z.uuid().safeParse(id).success).toBe(true);
  });

  it("encodes the millisecond timestamp in the first 48 bits", () => {
    const at = 1_758_355_200_000; // 2025-09-20T08:00:00Z
    expect(uuidv7Time(uuidv7(at))).toBe(at);
  });

  it("is time-ordered across calls", () => {
    const earlier = uuidv7(1_000_000);
    const later = uuidv7(1_000_001);
    expect(earlier < later).toBe(true);
    const ids = Array.from({ length: 1000 }, () => uuidv7());
    for (let i = 1; i < ids.length; i++) expect(uuidv7Time(ids[i] ?? "")).toBeGreaterThanOrEqual(uuidv7Time(ids[i - 1] ?? ""));
  });

  it("does not collide", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });
});
