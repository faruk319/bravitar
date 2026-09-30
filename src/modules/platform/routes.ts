import { readSessionCookie, sessionCookieHeader } from "@/lib/auth/cookie";
import { json, jsonError, pathSegment, readJson } from "@/lib/auth/route";
import { getPlatformSessionFromToken, type PlatformSession } from "@/lib/auth/session";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { metaOf, slugFromHost } from "@/modules/auth/routes";
import { addPlan, changePlan, editActivity, editBillingSettings, editPlan, setCancelAtPeriodEnd } from "@/modules/billing/service";
import { createAcademy, ownerInvite, setAcademyStatus, setModules } from "./academies";
import { platformSignIn } from "./auth";

// POST /api/platform/login, on the main site only.
export async function platformLoginHandler(req: Request): Promise<Response> {
  try {
    if (slugFromHost(req.headers.get("host"))) throw new NotFoundError("Page");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { token } = await platformSignIn({ email: String(body.email ?? ""), password: String(body.password ?? ""), code: String(body.code ?? ""), ...metaOf(req) });
    return json({ ok: true }, { headers: { "set-cookie": sessionCookieHeader(token) } });
  } catch (err) {
    return jsonError(err);
  }
}

// Every other /api/platform route: your session, on the main site only.
function withPlatformRequest(handler: (req: Request, actor: { actorType: "platform"; actorId: string }) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      if (slugFromHost(req.headers.get("host"))) throw new NotFoundError("Page");
      const token = readSessionCookie(req);
      const session: PlatformSession | undefined = token ? await getPlatformSessionFromToken(token) : undefined;
      if (!session) throw new UnauthorizedError();
      return await handler(req, { actorType: "platform", actorId: session.actor.id });
    } catch (err) {
      return jsonError(err);
    }
  };
}

// POST /api/platform/academies
export const createAcademyHandler = withPlatformRequest(async (req, actor) => json(await createAcademy(actor, await readJson(req)), { status: 201 }));

// PATCH /api/platform/academies/<id> { modules } | { status }
export const academyHandler = withPlatformRequest(async (req, actor) => {
  const id = pathSegment(req, 3);
  const body = (await readJson(req)) as Record<string, unknown>;
  if (body.modules) await setModules(actor, id, body.modules as Record<string, boolean>);
  else if (body.status) await setAcademyStatus(actor, id, body.status as never);
  else throw new NotFoundError("Change");
  return json({ ok: true });
});

// POST /api/platform/academies/<id>/invite: a new link for the owner.
export const ownerInviteHandler = withPlatformRequest(async (req, actor) => json({ inviteUrl: await ownerInvite(actor, pathSegment(req, 3)) }));

// PATCH /api/platform/activities/<key>: name, description, status.
export const activityHandler = withPlatformRequest(async (req, actor) => {
  await editActivity(actor, pathSegment(req, 3), await readJson(req));
  return json({ ok: true });
});

// POST /api/platform/activities/<key>/plans
export const addPlanHandler = withPlatformRequest(async (req, actor) => json({ id: (await addPlan(actor, pathSegment(req, 3), await readJson(req))).id }, { status: 201 }));

// PATCH /api/platform/plans/<id>: name, price, limits, offered.
export const planHandler = withPlatformRequest(async (req, actor) => {
  await editPlan(actor, pathSegment(req, 3), await readJson(req));
  return json({ ok: true });
});

// PATCH /api/platform/subscriptions/<id> { planId }: now or at the month's end;
// { cancelAtPeriodEnd }: ends it then, or not.
export const subscriptionHandler = withPlatformRequest(async (req, actor) => {
  const id = pathSegment(req, 3);
  const { planId, cancelAtPeriodEnd } = (await readJson(req)) as { planId?: unknown; cancelAtPeriodEnd?: unknown };
  if (typeof cancelAtPeriodEnd === "boolean") {
    await setCancelAtPeriodEnd(actor, id, cancelAtPeriodEnd);
    return json({ ok: true });
  }
  return json({ when: await changePlan(actor, id, String(planId ?? "")) });
});

// PATCH /api/platform/billing-settings
export const billingSettingsHandler = withPlatformRequest(async (req, actor) => {
  await editBillingSettings(actor, await readJson(req));
  return json({ ok: true });
});
