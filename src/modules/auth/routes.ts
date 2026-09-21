import { clearSessionCookieHeader, sessionCookieHeader } from "@/lib/auth/cookie";
import { json, jsonError, withStaffRequest } from "@/lib/auth/route";
import { getEnv } from "@/lib/env";
import { login, logout } from "./service";

// The tenant slug is the request's subdomain (<slug>.<APP_DOMAIN>); a `slug`
// body field is the fallback for tests and curl.
export function slugFromHost(host: string | null, appDomain = getEnv().APP_DOMAIN): string | undefined {
  if (!host) return undefined;
  const suffix = `.${appDomain}`;
  if (!host.endsWith(suffix)) return undefined;
  const slug = host.slice(0, -suffix.length);
  return slug && !slug.includes(".") ? slug : undefined;
}

export async function loginHandler(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const slug = slugFromHost(req.headers.get("host")) ?? (typeof body.slug === "string" ? body.slug : "");
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const { token, context } = await login({
      slug,
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      ...(ip ? { ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    });
    return json(context, { status: 200, headers: { "set-cookie": sessionCookieHeader(token) } });
  } catch (err) {
    return jsonError(err);
  }
}

export const logoutHandler = withStaffRequest(null, async ({ session }) => {
  await logout(session.tenant.id, session.sessionId, session.actor.id);
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookieHeader() } });
});

export const meHandler = withStaffRequest(null, async ({ session }) => {
  const { actor, tenant, branchIds, isOwner, modules, permissions } = session;
  return json({ actor, tenant, branchIds, isOwner, modules, permissions });
});
