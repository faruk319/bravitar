import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

// Cookie-only redirects; this runs without database access. The (tenant)
// layout validates the session for real and redirects if it is dead.
export function proxy(req: NextRequest) {
  const hasCookie = req.cookies.has(SESSION_COOKIE);
  const { pathname } = req.nextUrl;
  if (pathname === "/login" && hasCookie) return NextResponse.redirect(new URL("/", req.url));
  if (pathname !== "/login" && pathname !== "/" && !hasCookie) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
