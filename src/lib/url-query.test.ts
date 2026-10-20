import { describe, expect, it } from "vitest";
import { queryReader, withQuery } from "./url-query";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("reading a list's address", () => {
  const read = queryReader({ q: "  Riya ", blank: "  ", list: ["a", "b"], id: ID, badId: "nope", day: "2026-10-20", badDay: "2026-02-30", kind: "upi", badKind: "gold", page: "3" });

  it("trims what it reads and drops what is empty or repeated", () => {
    expect([read.one("q"), read.one("blank"), read.one("list"), read.one("none")]).toEqual(["Riya", undefined, undefined, undefined]);
  });

  it("drops an id, a day or a choice that is not valid, so a stale link still loads", () => {
    expect([read.id("id"), read.id("badId"), read.day("day"), read.day("badDay")]).toEqual([ID, undefined, "2026-10-20", undefined]);
    expect([read.oneOf("kind", ["cash", "upi"] as const), read.oneOf("badKind", ["cash", "upi"] as const)]).toEqual(["upi", undefined]);
  });

  it("starts on page 1 and never goes below it", () => {
    expect([read.page(), queryReader({}).page(), queryReader({ page: "0" }).page(), queryReader({ page: "-2" }).page(), queryReader({ page: "2.7" }).page(), queryReader({ page: "x" }).page()]).toEqual([3, 1, 1, 1, 2, 1]);
  });
});

describe("an address with its query", () => {
  it("is the bare path when nothing is set", () => {
    expect(withQuery("/x", new URLSearchParams())).toBe("/x");
    expect(withQuery("/x", new URLSearchParams("a=1&b=2"))).toBe("/x?a=1&b=2");
  });
});
