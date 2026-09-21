import { describe, expect, it } from "vitest";
import { clearSessionCookieHeader, readSessionCookie, SESSION_COOKIE, sessionCookieHeader } from "./cookie";

describe("session cookie", () => {
  it("reads its own cookie among others, url-decoded", () => {
    const req = new Request("http://x", { headers: { cookie: `a=1; ${SESSION_COOKIE}=${encodeURIComponent("tok+en=1")}; b=2` } });
    expect(readSessionCookie(req)).toBe("tok+en=1");
    expect(readSessionCookie(new Request("http://x"))).toBeUndefined();
    expect(readSessionCookie(new Request("http://x", { headers: { cookie: "other=1" } }))).toBeUndefined();
  });

  it("sets HttpOnly, SameSite=Lax, Path=/ and Secure outside development", () => {
    expect(sessionCookieHeader("t", false)).toBe(`${SESSION_COOKIE}=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    expect(sessionCookieHeader("t", true)).toMatch(/; Secure$/);
  });

  it("clears with Max-Age=0", () => {
    expect(clearSessionCookieHeader(false)).toBe(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  });
});
