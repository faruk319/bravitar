import { describe, expect, it } from "vitest";
import { payerKey, payerOf } from "./payer";

const ID = "0192f3a0-0000-7000-8000-000000000001";

describe("payerOf", () => {
  it("reads a guardian payer", () => {
    expect(payerOf({ payerGuardianId: ID, payerMemberId: null })).toEqual({ kind: "guardian", guardianId: ID });
  });
  it("reads a member payer", () => {
    expect(payerOf({ payerGuardianId: null, payerMemberId: ID })).toEqual({ kind: "member", memberId: ID });
  });
  it("returns null when neither is set", () => {
    expect(payerOf({ payerGuardianId: null, payerMemberId: null })).toBeNull();
  });
  it("throws when both are set", () => {
    expect(() => payerOf({ payerGuardianId: ID, payerMemberId: ID })).toThrow("both a guardian and a member");
  });
});

describe("payerKey", () => {
  it("keeps a guardian and a member with the same id apart", () => {
    const g = payerKey({ kind: "guardian", guardianId: ID });
    const m = payerKey({ kind: "member", memberId: ID });
    expect(g).toBe(`guardian:${ID}`);
    expect(m).toBe(`member:${ID}`);
    expect(g).not.toBe(m);
  });
  it("is stable for the same payer and differs for different ids", () => {
    expect(payerKey({ kind: "member", memberId: ID })).toBe(payerKey({ kind: "member", memberId: ID }));
    expect(payerKey({ kind: "member", memberId: ID })).not.toBe(payerKey({ kind: "member", memberId: ID.replace(/1$/, "2") }));
  });
});
