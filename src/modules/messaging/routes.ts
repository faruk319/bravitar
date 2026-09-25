import { json, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { BadRequestError } from "@/lib/errors";
import { webhookRoute } from "@/modules/integrations/routes";
import { type ComposeRequest, composeMessage, MESSAGE_ACTIONS, messageAction, saveMessagingSettings, saveTemplate } from "./service";
import type { TemplateKey } from "./templates";
import { handleWhatsappWebhook, verifyWhatsappWebhook } from "./webhook";

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

export const composeRoute = withStaffRequest("messages:send", async (r) => json(await composeMessage(r.tx, ctxOf(r), await readJson<ComposeRequest>(r.req))));

export const templateRoute = withStaffRequest("messages:manage", async (r) =>
  json(await saveTemplate(r.tx, ctxOf(r), pathSegment(r.req, 3) as TemplateKey, await readJson<Parameters<typeof saveTemplate>[3]>(r.req))),
);

export const messagingSettingsRoute = withStaffRequest("messages:manage", async (r) => json(await saveMessagingSettings(r.tx, ctxOf(r), await readJson<Parameters<typeof saveMessagingSettings>[2]>(r.req))));

export const messageActionRoute = withStaffRequest("messages:send", async (r) => {
  const { action } = await readJson<{ action?: string }>(r.req);
  const known = MESSAGE_ACTIONS.find((a) => a === action);
  if (!known) throw new BadRequestError("Unknown action");
  return json(await messageAction(r.tx, ctxOf(r), pathSegment(r.req, 2), known));
});

// /api/webhooks/whatsapp/<academy>: Meta's delivery reports (POST) and its setup check (GET).
export const whatsappWebhookRoute = webhookRoute("whatsapp", (slug, raw, req) => handleWhatsappWebhook(slug, raw, req.headers.get("x-hub-signature-256")));

export async function whatsappVerifyRoute(req: Request): Promise<Response> {
  const r = await verifyWhatsappWebhook(pathSegment(req, 3), new URL(req.url).searchParams);
  return new Response(r.body, { status: r.status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
