import { describe, expect, it } from "vitest";
import { isActive } from "./nav-link";

describe("isActive", () => {
  it("lights the page's own item, and a parent only when no more specific item matches", () => {
    const all = ["/payments/new", "/payments", "/students"];
    expect(isActive("/payments/new", "/payments/new", all)).toBe(true);
    expect(isActive("/payments/new", "/payments", all)).toBe(false);
    expect(isActive("/payments/0192-abc", "/payments", all)).toBe(true); // a receipt sits under Collection
    expect(isActive("/students/42", "/students", all)).toBe(true);
    expect(isActive("/studentsx", "/students", all)).toBe(false);
  });
});
