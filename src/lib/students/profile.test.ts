import { describe, expect, it } from "vitest";
import { emailRows } from "./profile";

describe("emailRows", () => {
  it("names whose address it is", () => {
    expect(emailRows([{ relation: "father", email: "salim@x.test" }, { relation: "mother", email: null }, { relation: "self", email: "me@x.test" }])).toEqual([
      { label: "Email (father)", value: "salim@x.test" },
      { label: "Email (self)", value: "me@x.test" },
    ]);
  });
  it("is empty with no guardian", () => {
    expect(emailRows([])).toEqual([]);
  });
});
