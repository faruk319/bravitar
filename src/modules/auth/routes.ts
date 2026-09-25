import { clearSessionCookieHeader, sessionCookieHeader } from "@/lib/auth/cookie";
import { json, jsonError, withStaffRequest } from "@/lib/auth/route";
import { getEnv } from "@/lib/env";
import { login, logout, redeemHandoff, signIn } from "./service";

// The tenant slug is the request's subdomain (<slug>.<APP_DOMAIN>); a `slug`
// body field is the fallback for tests and curl.
export function slugFromHost(host: string | null, appDomain = getEnv().APP_DOMAIN): string | undefined {
  if (!host) return undefined;
  const suffix = `.${appDomain}`;
  if (!host.endsWith(suffix)) return undefined;
  const slug = host.slice(0, -suffix.length);
  return slug && !slug.includes(".") ? slug : undefined;
}

const metaOf = (req: Request) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = req.headers.get("user-agent") ?? undefined;
  return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) };
};

export async function loginHandler(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const slug = slugFromHost(req.headers.get("host")) ?? (typeof body.slug === "string" ? body.slug : "");
    const { token, context } = await login({ slug, email: String(body.email ?? ""), password: String(body.password ?? ""), ...metaOf(req) });
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

// POST /api/auth/sign-in on the main site: the academies this email and
// password open, each with a one-time pass to its own address.
export async function signInHandler(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return json({ academies: await signIn({ email: String(body.email ?? ""), password: String(body.password ?? ""), ...metaOf(req) }) });
  } catch (err) {
    return jsonError(err);
  }
}

// GET /api/auth/handoff?t= on the academy's address: the pass becomes this
// address's own session cookie. The token never lingers in the address bar.
export async function handoffHandler(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const opened = await redeemHandoff(slugFromHost(req.headers.get("host")), token, metaOf(req));
  const headers = new Headers({ location: opened ? "/" : "/login?expired=1", "referrer-policy": "no-referrer", "cache-control": "no-store" });
  if (opened) headers.set("set-cookie", sessionCookieHeader(opened.token));
  return new Response(null, { status: 303, headers });
}
