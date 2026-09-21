export const BRANCH_COOKIE = "bravitar_branch";

export function branchCookieHeader(value: string, secure = process.env.NODE_ENV === "production"): string {
  return `${BRANCH_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}${secure ? "; Secure" : ""}`;
}
