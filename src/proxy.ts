import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

// Cookie-only redirect to /login; this runs without database access. A
// cookie is no proof of a live session (it may be expired or revoked), so
// /login is never redirected here: the login page checks the session itself.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Invite links and a family's private receipt (/r/) or invoice (/i/) links carry their own token.
  const open = pathname === "/login" || pathname === "/" || pathname === "/platform/login" || ["/login/", "/invite/", "/r/", "/i/"].some((p) => pathname.startsWith(p));
  if (!open && !req.cookies.has(SESSION_COOKIE)) return NextResponse.redirect(new URL(pathname.startsWith("/platform") ? "/platform/login" : "/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
