import { readSessionCookie, sessionCookieHeader } from "@/lib/auth/cookie";
import { json, jsonError, pathSegment, readJson } from "@/lib/auth/route";
import { getPlatformSessionFromToken, type PlatformSession } from "@/lib/auth/session";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { metaOf, slugFromHost } from "@/modules/auth/routes";
import { cancelPayment, recordPayment, voidBill } from "@/modules/billing/payments";
import { addPlan, addTrialDays, changePlan, editActivity, editBillingSettings, editPlan, setCancelAtPeriodEnd, setDefaultPlan, setPrice } from "@/modules/billing/service";
import { createAcademy, impersonate, ownerInvite, setAcademyStatus, setModules } from "./academies";
import { retryMessage } from "./queues";
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

// POST /api/platform/academies/<id>/impersonate { reason }: a pass to sign in as its owner.
export const impersonateHandler = withPlatformRequest(async (req, actor) => json({ url: await impersonate(actor, pathSegment(req, 3), await readJson(req)) }, { status: 201 }));

// POST /api/platform/messages/<id> { action: "retry" }: a failed message back in its queue.
export const messageHandler = withPlatformRequest(async (req, actor) => {
  if ((await readJson<{ action?: string }>(req)).action !== "retry") throw new NotFoundError("Action");
  await retryMessage(actor, pathSegment(req, 3));
  return json({ ok: true });
});

// PATCH /api/platform/activities/<key>: name, description, icon, status.
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

// POST /api/platform/plans/<id>/default: its module's plan when none is picked.
export const defaultPlanHandler = withPlatformRequest(async (req, actor) => {
  await setDefaultPlan(actor, pathSegment(req, 3));
  return json({ ok: true });
});

// PATCH /api/platform/subscriptions/<id> { planId }: now or at the month's end;
// { cancelAtPeriodEnd }: ends it then, or not; { price }: free use or a
// special price; { trialDays }: extra trial days.
export const subscriptionHandler = withPlatformRequest(async (req, actor) => {
  const id = pathSegment(req, 3);
  const body = await readJson<{ planId?: string; cancelAtPeriodEnd?: boolean; price?: Parameters<typeof setPrice>[2]; trialDays?: Parameters<typeof addTrialDays>[2] }>(req);
  if (typeof body.cancelAtPeriodEnd === "boolean") {
    await setCancelAtPeriodEnd(actor, id, body.cancelAtPeriodEnd);
    return json({ ok: true });
  }
  if (body.price) return json(await setPrice(actor, id, body.price));
  if (body.trialDays) return json(await addTrialDays(actor, id, body.trialDays));
  return json({ when: await changePlan(actor, id, String(body.planId ?? "")) });
});

// POST /api/platform/billing-invoices/<id>/void { reason }
export const voidBillHandler = withPlatformRequest(async (req, actor) => {
  await voidBill(actor, pathSegment(req, 3), await readJson(req));
  return json({ ok: true });
});

// POST /api/platform/billing-payments/<id>/cancel { reason }
export const cancelPaymentHandler = withPlatformRequest(async (req, actor) => {
  await cancelPayment(actor, pathSegment(req, 3), await readJson(req));
  return json({ ok: true });
});

// POST /api/platform/subscriptions/<id>/payments: a payment recorded by hand.
export const recordPaymentHandler = withPlatformRequest(async (req, actor) => {
  const r = await recordPayment(actor, pathSegment(req, 3), await readJson(req));
  return json({ id: r.payment.id, started: r.started, resumed: r.resumed }, { status: 201 });
});

// PATCH /api/platform/billing-settings
export const billingSettingsHandler = withPlatformRequest(async (req, actor) => {
  await editBillingSettings(actor, await readJson(req));
  return json({ ok: true });
});
