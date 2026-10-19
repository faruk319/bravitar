import { describe, expect, it } from "vitest";
import { isActive } from "./nav-link";

describe("isActive", () => {
  it("lights the page's own item, and a parent only when no more specific item matches", () => {
    const all = ["/finance", "/finance/collections", "/students"];
    expect(isActive("/finance/collections", "/finance/collections", all)).toBe(true);
    expect(isActive("/finance/collections", "/finance", all)).toBe(false);
    expect(isActive("/finance/collections/0192-abc", "/finance/collections", all)).toBe(true); // a receipt sits under Collections
    expect(isActive("/finance/reports", "/finance", all)).toBe(true);
    expect(isActive("/students/42", "/students", all)).toBe(true);
    expect(isActive("/studentsx", "/students", all)).toBe(false);
  });
});
