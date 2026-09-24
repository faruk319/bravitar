import { createHash } from "node:crypto";
import { z } from "zod";
import { signatureMatches } from "@/lib/crypto";
import type { Tx } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { getInvoice } from "@/modules/fees/repo";
import { closeLink, linkByGatewayId, linkById } from "@/modules/payments/repo";
import { recordGatewayPayment, recordGatewayRefund } from "@/modules/payments/service";
import { markEvent, storeEvent } from "./repo";
import { razorpayKeys } from "./service";

// docs/04 "Razorpay payment link flow", webhook rules, and docs/03 §9 (agreed
// 2026-09-25): the signature is checked with that academy's own webhook secret
// before anything is read; each event is stored once per academy, then handled
// in the same transaction, which is the academy's own (RLS).

export const MAX_BODY = 256 * 1024;

const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;
// Razorpay sends empty notes as [].
const notes = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .optional()
  .transform((n): Record<string, unknown> => (n && !Array.isArray(n) ? n : {}));
const paymentEntity = z.object({ id: z.string(), amount: z.number().int(), status: z.string(), created_at: z.number(), notes });
const eventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment_link: z.object({ entity: z.object({ id: z.string(), reference_id: z.string().nullish(), notes }) }).optional(),
    payment: z.object({ entity: paymentEntity }).optional(),
    refund: z.object({ entity: z.object({ id: z.string(), payment_id: z.string(), amount: z.number().int(), created_at: z.number() }) }).optional(),
  }),
});
type RazorpayEvent = z.infer<typeof eventSchema>;

export type WebhookResult = { status: number; body: Record<string, unknown> };

// What happened, kept on the stored event: nothing (done) or why nothing was recorded.
async function handle(tx: Tx, tenantId: string, ev: RazorpayEvent, now: Date): Promise<string | null> {
  const paid = async (invoiceId: string, pay: z.infer<typeof paymentEntity>) => {
    if (pay.status !== "captured") return `the payment is ${pay.status}`;
    await recordGatewayPayment(tx, { invoiceId, gatewayPaymentId: pay.id, amountPaise: BigInt(pay.amount), capturedAt: new Date(pay.created_at * 1000) }, { now });
    return null;
  };
  switch (ev.event) {
    case "payment_link.paid": {
      const pl = ev.payload.payment_link?.entity;
      const pay = ev.payload.payment?.entity;
      if (!pl || !pay) return "no link or payment in the event";
      if (pl.notes.tenant_id !== undefined && pl.notes.tenant_id !== tenantId) return "the link names another academy";
      const link = (await linkByGatewayId(tx, pl.id)) ?? (isUuid(pl.reference_id) ? await linkById(tx, pl.reference_id) : undefined);
      const invoiceId = link?.invoiceId ?? (isUuid(pl.notes.invoice_id) ? pl.notes.invoice_id : undefined);
      if (!invoiceId || !(await getInvoice(tx, [], invoiceId))) return "no invoice here for this link";
      const problem = await paid(invoiceId, pay);
      if (!problem && link) await closeLink(tx, link.id, "paid", now);
      return problem;
    }
    case "payment.captured": {
      // May come before payment_link.paid: the Razorpay payment id makes it one payment.
      const pay = ev.payload.payment?.entity;
      if (!pay) return "no payment in the event";
      if (!isUuid(pay.notes.invoice_id)) return null; // not one of our links; payment_link.paid or the hourly check records it
      if (pay.notes.tenant_id !== undefined && pay.notes.tenant_id !== tenantId) return "the payment names another academy";
      if (!(await getInvoice(tx, [], pay.notes.invoice_id))) return "no invoice here for this payment";
      const problem = await paid(pay.notes.invoice_id, pay);
      if (!problem && isUuid(pay.notes.link_id)) {
        const link = await linkById(tx, pay.notes.link_id);
        if (link) await closeLink(tx, link.id, "paid", now);
      }
      return problem;
    }
    case "refund.processed": {
      const rf = ev.payload.refund?.entity;
      if (!rf) return "no refund in the event";
      const r = await recordGatewayRefund(tx, { gatewayPaymentId: rf.payment_id, gatewayRefundId: rf.id, amountPaise: BigInt(rf.amount), refundedAt: new Date(rf.created_at * 1000) }, { now });
      return r.problem ?? null;
    }
    default:
      return null; // payment.failed and anything else: stored, nothing to record
  }
}

export async function handleRazorpayWebhook(slug: string, raw: string, headers: { signature: string | null; eventId: string | null }, opts: { now?: Date } = {}): Promise<WebhookResult> {
  const tenant = await resolveTenantBySlug(slug);
  if (!tenant || tenant.status !== "active") return { status: 404, body: { error: "Unknown academy" } };
  return withTenant(tenant.id, async (tx) => {
    const keys = await razorpayKeys(tx, { includeInactive: true });
    if (!keys) return { status: 404, body: { error: "Razorpay isn't connected" } };
    if (!signatureMatches(raw, keys.webhookSecret, headers.signature)) {
      console.warn(`razorpay webhook: signature mismatch for ${slug}`);
      return { status: 400, body: { error: "Bad signature" } };
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { status: 400, body: { error: "Not JSON" } };
    }
    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) return { status: 400, body: { error: "Not a Razorpay event" } };
    const eventId = headers.eventId || `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    const stored = await storeEvent(tx, { tenantId: tenant.id, provider: "razorpay", providerEventId: eventId, event: parsed.data.event, payload: json });
    if (!stored) return { status: 200, body: { duplicate: true } };
    const now = opts.now ?? new Date();
    const problem = await handle(tx, tenant.id, parsed.data, now);
    await markEvent(tx, stored.id, now, problem);
    return { status: 200, body: problem ? { ok: true, note: problem } : { ok: true } };
  });
}
