import { json, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { connectRazorpay, connectWhatsapp, testRazorpay, testWhatsapp } from "./service";
import { handleRazorpayWebhook, MAX_BODY, type WebhookResult } from "./webhook";

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

// The response is the connection's status; never the keys.
export const connectRazorpayRoute = withStaffRequest("integrations:manage", async (r) => json(await connectRazorpay(r.tx, ctxOf(r), await readJson(r.req))));

export const testRazorpayRoute = withStaffRequest("integrations:manage", async (r) => json(await testRazorpay(r.tx, ctxOf(r))));

export const connectWhatsappRoute = withStaffRequest("integrations:manage", async (r) => json(await connectWhatsapp(r.tx, ctxOf(r), await readJson(r.req))));

export const testWhatsappRoute = withStaffRequest("integrations:manage", async (r) => json(await testWhatsapp(r.tx, ctxOf(r))));

// POST /api/webhooks/<provider>/<academy>. No session: the signature, checked
// with that academy's own secret, is the proof. Errors are logged without the
// payload (a parent's contact) and answered 500, so the provider tries again.
export function webhookRoute(provider: string, handle: (slug: string, raw: string, req: Request) => Promise<WebhookResult>) {
  return async (req: Request): Promise<Response> => {
    try {
      if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: "Too large" }, { status: 413 });
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ error: "Too large" }, { status: 413 });
      const r = await handle(pathSegment(req, 3), raw, req);
      return json(r.body, { status: r.status });
    } catch (e) {
      console.error(`${provider} webhook failed: ${e instanceof Error ? e.message : "unknown error"}`);
      return json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export const razorpayWebhookRoute = webhookRoute("razorpay", (slug, raw, req) =>
  handleRazorpayWebhook(slug, raw, { signature: req.headers.get("x-razorpay-signature"), eventId: req.headers.get("x-razorpay-event-id") }),
);
