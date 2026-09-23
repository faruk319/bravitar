import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const req = (path: string, cookie?: string) => new NextRequest(`http://shivaji-karate.localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

describe("proxy", () => {
  it("sends visitors without a session cookie to /login", () => {
    const res = proxy(req("/students"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://shivaji-karate.localhost:3000/login");
  });

  it("lets /login through even with a cookie, so a stale cookie can't loop between / and /login", () => {
    expect(proxy(req("/login", "bravitar_session=stale")).headers.get("location")).toBeNull();
    expect(proxy(req("/login")).headers.get("location")).toBeNull();
  });

  it("lets pages through when a cookie exists; the layout checks it for real", () => {
    expect(proxy(req("/students", "bravitar_session=anything")).headers.get("location")).toBeNull();
    expect(proxy(req("/")).headers.get("location")).toBeNull();
  });
});
