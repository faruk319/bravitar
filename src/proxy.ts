import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

// Cookie-only redirect to /login; this runs without database access. A
// cookie is no proof of a live session (it may be expired or revoked), so
// /login is never redirected here: the login page checks the session itself.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname !== "/login" && pathname !== "/" && !req.cookies.has(SESSION_COOKIE)) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
