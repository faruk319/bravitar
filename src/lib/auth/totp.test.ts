import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, newTotpSecret, totp, totpMatch, totpStep } from "./totp";

// RFC 6238 appendix B (SHA-1) and RFC 4226 appendix D.
const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET = base32Encode(RFC_KEY);

describe("totp", () => {
  it("matches RFC 4226's HOTP values", () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(RFC_KEY, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });

  it("matches RFC 6238's 8-digit values", () => {
    const cases: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, code] of cases) expect(totp(RFC_SECRET, new Date(seconds * 1000), 8)).toBe(code);
  });

  it("accepts a code one step early or late, not two; says which step it was", () => {
    const at = new Date(1_700_000_000_000);
    const secret = newTotpSecret();
    const now = totpStep(at);
    expect(totpMatch(secret, totp(secret, at), at)).toBe(now);
    expect(totpMatch(secret, totp(secret, new Date(at.getTime() - 30_000)), at)).toBe(now - 1);
    expect(totpMatch(secret, totp(secret, new Date(at.getTime() + 30_000)), at)).toBe(now + 1);
    expect(totpMatch(secret, totp(secret, new Date(at.getTime() - 60_000)), at)).toBeUndefined();
    expect(totpMatch(secret, "12345", at)).toBeUndefined();
  });

  it("round-trips base32 with the spaces apps show", () => {
    const key = Buffer.from("hello authenticator");
    expect(base32Decode(base32Encode(key).replace(/(.{4})/g, "$1 "))).toEqual(key);
  });
});
