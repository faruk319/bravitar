import { describe, expect, it } from "vitest";
import { payerKey, payerOf, planPayer } from "./payer";

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

describe("planPayer", () => {
  const enrollment = { studentId: "s1", payerGuardianId: null, payerMemberId: null };
  it("is the enrollment's own payer, whoever the lead guardian is", () => {
    expect(planPayer({ ...enrollment, payerGuardianId: ID }, "lead")).toEqual({ kind: "guardian", guardianId: ID });
    expect(planPayer({ ...enrollment, payerMemberId: ID }, "lead")).toEqual({ kind: "member", memberId: ID });
  });
  it("with none of its own, is the member's lead guardian, else the member themselves", () => {
    expect(planPayer(enrollment, "lead")).toEqual({ kind: "guardian", guardianId: "lead" });
    expect(planPayer(enrollment, undefined)).toEqual({ kind: "member", memberId: "s1" });
  });
  it("throws when both payer columns are set, so a caller can skip the row", () => {
    expect(() => planPayer({ ...enrollment, payerGuardianId: ID, payerMemberId: ID }, "lead")).toThrow("both a guardian and a member");
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
