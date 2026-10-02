import { clearSessionCookieHeader, readSessionCookie, sessionCookieHeader } from "@/lib/auth/cookie";
import { json, jsonError, readJson, scopedCtx, withStaffRequest } from "@/lib/auth/route";
import { getGuardianSessionFromToken, getPlatformSessionFromToken, getStaffSessionFromToken } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { platformLogout } from "@/modules/platform/auth";
import { requestPortalCode, verifyPortalCode } from "./guardian";
import { requestReset, resetPassword } from "./reset";
import { login, logout, redeemHandoff, setOwnPhone, signIn } from "./service";

// The tenant slug is the request's subdomain (<slug>.<APP_DOMAIN>); a `slug`
// body field is the fallback for tests and curl.
export function slugFromHost(host: string | null, appDomain = getEnv().APP_DOMAIN): string | undefined {
  if (!host) return undefined;
  const suffix = `.${appDomain}`;
  if (!host.endsWith(suffix)) return undefined;
  const slug = host.slice(0, -suffix.length);
  return slug && !slug.includes(".") ? slug : undefined;
}

export const metaOf = (req: Request) => {
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

// Ends this address's session: a staff member's, a guardian's or yours on /platform.
export async function logoutHandler(req: Request): Promise<Response> {
  try {
    const token = readSessionCookie(req);
    const session = token ? ((await getStaffSessionFromToken(token)) ?? (await getGuardianSessionFromToken(token))) : undefined;
    if (session) await logout(session.tenant.id, session.sessionId, { actorType: session.actor.type, actorId: session.actor.id }, "impersonation" in session ? session.impersonation?.by : undefined);
    const platform = token && !session ? await getPlatformSessionFromToken(token) : undefined;
    if (platform) await platformLogout(platform.sessionId, platform.actor.id);
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookieHeader() } });
  } catch (err) {
    return jsonError(err);
  }
}

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
  const headers = new Headers({ location: opened?.home ?? "/login?expired=1", "referrer-policy": "no-referrer", "cache-control": "no-store" });
  if (opened) headers.set("set-cookie", sessionCookieHeader(opened.token));
  return new Response(null, { status: 303, headers });
}

// POST /api/auth/reset/code: the same answer whether or not the email exists.
export async function resetCodeHandler(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    await requestReset({ email: String(body.email ?? "") }, { slug: slugFromHost(req.headers.get("host")) });
    return json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}

// POST /api/auth/reset: on an academy's address it signs in here; on the main
// site it answers like sign-in, with a pass per academy.
export async function resetHandler(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const done = await resetPassword(
      { email: String(body.email ?? ""), code: String(body.code ?? ""), password: String(body.password ?? "") },
      { slug: slugFromHost(req.headers.get("host")), meta: metaOf(req) },
    );
    return "session" in done ? json({ ok: true }, { headers: { "set-cookie": sessionCookieHeader(done.session.token) } }) : json({ academies: done.academies });
  } catch (err) {
    return jsonError(err);
  }
}

// PATCH /api/auth/me/phone: one's own phone for reset codes, behind the password.
export const phoneHandler = withStaffRequest(null, async (r) => {
  const phone = await setOwnPhone(r.tx, scopedCtx(r.session, r.req), await readJson(r.req));
  return phone ? json({ phone }) : json({ error: "That password isn't right" }, { status: 400 });
});

// POST /api/auth/code: a parent's sign-in code on WhatsApp; the same answer for any number.
export async function phoneCodeHandler(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    await requestPortalCode({ phone: String(body.phone ?? "") }, { slug: slugFromHost(req.headers.get("host")) });
    return json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}

// POST /api/auth/verify: on an academy's address it signs in here; on the
// main site it answers like sign-in, with a pass per academy.
export async function phoneSignInHandler(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const done = await verifyPortalCode({ phone: String(body.phone ?? ""), code: String(body.code ?? "") }, { slug: slugFromHost(req.headers.get("host")), meta: metaOf(req) });
    return "token" in done ? json({ ok: true }, { headers: { "set-cookie": sessionCookieHeader(done.token) } }) : json({ academies: done.academies });
  } catch (err) {
    return jsonError(err);
  }
}
