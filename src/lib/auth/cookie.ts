export const SESSION_COOKIE = "bravitar_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function attrs(maxAge: number, secure: boolean): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function sessionCookieHeader(token: string, secure = process.env.NODE_ENV === "production"): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${attrs(SESSION_MAX_AGE_SECONDS, secure)}`;
}

export function clearSessionCookieHeader(secure = process.env.NODE_ENV === "production"): string {
  return `${SESSION_COOKIE}=; ${attrs(0, secure)}`;
}
