import { z } from "zod";
import { signatureMatches } from "@/lib/crypto";
import { withTenant } from "@/lib/db/with-tenant";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { markEvent, storeEvent } from "@/modules/integrations/repo";
import { verifyTokenMatches, whatsappKeys } from "@/modules/integrations/service";
import type { WebhookResult } from "@/modules/integrations/webhook";
import { applyDeliveryStatus } from "./service";

// docs/06 Prompt 17 step 3: Meta's delivery reports for an academy's own
// number. The signature (X-Hub-Signature-256, with that academy's app secret)
// is checked before anything is read; each report is stored once, then applied
// in the same transaction, which is the academy's own (RLS).

const REPORTS = ["sent", "delivered", "read", "failed"] as const;
const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  errors: z.array(z.object({ title: z.string().optional(), message: z.string().optional(), error_data: z.object({ details: z.string().optional() }).optional() })).optional(),
});
const bodySchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({ changes: z.array(z.object({ field: z.string(), value: z.object({ metadata: z.object({ phone_number_id: z.string() }).optional(), statuses: z.array(statusSchema).optional() }) })) }),
  ),
});

const errorOf = (s: z.infer<typeof statusSchema>) => {
  const e = s.errors?.[0];
  return e ? e.error_data?.details || e.message || e.title || null : null;
};

export async function handleWhatsappWebhook(slug: string, raw: string, signature: string | null, opts: { now?: Date } = {}): Promise<WebhookResult> {
  const tenant = await resolveTenantBySlug(slug);
  if (!tenant || tenant.status !== "active") return { status: 404, body: { error: "Unknown academy" } };
  return withTenant(tenant.id, async (tx) => {
    const keys = await whatsappKeys(tx);
    if (!keys) return { status: 404, body: { error: "WhatsApp isn't connected" } };
    if (!signatureMatches(raw, keys.appSecret, signature?.replace(/^sha256=/, ""))) {
      console.warn(`whatsapp webhook: signature mismatch for ${slug}`);
      return { status: 400, body: { error: "Bad signature" } };
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { status: 400, body: { error: "Not JSON" } };
    }
    // Replies from parents and anything else: acknowledged, not kept.
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return { status: 200, body: { ignored: true } };
    const statuses = parsed.data.entry
      .flatMap((e) => e.changes)
      .filter((c) => c.field === "messages" && c.value.metadata?.phone_number_id === keys.phoneNumberId)
      .flatMap((c) => c.value.statuses ?? []);
    const now = opts.now ?? new Date();
    let duplicates = 0;
    for (const s of statuses) {
      const status = REPORTS.find((r) => r === s.status);
      if (!status) continue;
      const stored = await storeEvent(tx, { tenantId: tenant.id, provider: "whatsapp", providerEventId: `${s.id}:${status}`, event: `message.${status}`, payload: s });
      if (!stored) {
        duplicates++;
        continue;
      }
      await markEvent(tx, stored.id, now, await applyDeliveryStatus(tx, s.id, status, errorOf(s)));
    }
    return { status: 200, body: duplicates ? { ok: true, duplicates } : { ok: true } };
  });
}

// Meta's check when the webhook is set up (GET): the challenge is echoed only
// for this academy's own verify token.
export async function verifyWhatsappWebhook(slug: string, params: URLSearchParams): Promise<{ status: number; body: string }> {
  const challenge = params.get("hub.challenge") ?? "";
  if (params.get("hub.mode") !== "subscribe" || !/^[A-Za-z0-9_-]{1,128}$/.test(challenge)) return { status: 400, body: "Bad request" };
  const tenant = await resolveTenantBySlug(slug);
  if (!tenant || tenant.status !== "active") return { status: 404, body: "Unknown academy" };
  const ok = await withTenant(tenant.id, async (tx) => verifyTokenMatches(await whatsappKeys(tx), params.get("hub.verify_token")));
  return ok ? { status: 200, body: challenge } : { status: 403, body: "Wrong verify token" };
}
