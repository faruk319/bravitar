import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { keyFrom, open, seal, signatureMatches } from "./index";

const key = randomBytes(32);
const owner = "tenant:0192-a:razorpay";

describe("seal and open", () => {
  it("round-trips, and the sealed bytes never contain the secret", () => {
    const secret = JSON.stringify({ keySecret: "rzp-secret-value" });
    const sealed = seal(secret, owner, key);
    expect(open(sealed, owner, key)).toBe(secret);
    expect(sealed.includes(Buffer.from("rzp-secret-value"))).toBe(false);
  });

  it("seals the same secret differently each time", () => {
    expect(seal("x", owner, key).equals(seal("x", owner, key))).toBe(false);
  });

  it("won't open for another owner, another key, or after tampering", () => {
    const sealed = seal("secret", owner, key);
    expect(() => open(sealed, "tenant:0192-b:razorpay", key)).toThrow("does not open");
    expect(() => open(sealed, owner, randomBytes(32))).toThrow("does not open");
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => open(tampered, owner, key)).toThrow("does not open");
    expect(() => open(Buffer.from([9, 9, 9]), owner, key)).toThrow("not readable");
  });

  it("needs a 32-byte key", () => {
    expect(() => keyFrom(undefined)).toThrow("APP_ENCRYPTION_KEY is not set");
    expect(() => keyFrom(randomBytes(16).toString("base64"))).toThrow("32 bytes");
    expect(keyFrom(key.toString("base64")).equals(key)).toBe(true);
  });
});

describe("signatureMatches", () => {
  const body = '{"event":"payment_link.paid"}';
  const good = createHmac("sha256", "whsec").update(body).digest("hex");

  it("accepts the right HMAC and nothing else", () => {
    expect(signatureMatches(body, "whsec", good)).toBe(true);
    expect(signatureMatches(`${body} `, "whsec", good)).toBe(false);
    expect(signatureMatches(body, "other", good)).toBe(false);
    expect(signatureMatches(body, "whsec", good.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBe(false);
    expect(signatureMatches(body, "whsec", "abc")).toBe(false);
    expect(signatureMatches(body, "whsec", null)).toBe(false);
  });
});
