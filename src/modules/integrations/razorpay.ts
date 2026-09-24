// An academy's own Razorpay account, over its REST API (https://razorpay.com/docs/api/).
// Only ever built from that academy's sealed keys (see service.ts). Our own SaaS
// billing must never come through here (docs/04 "Who receives the money").

export type RazorpayCredentials = { keyId: string; keySecret: string; webhookSecret: string };

export type RazorpayLinkStatus = "created" | "partially_paid" | "paid" | "cancelled" | "expired";
export type RazorpayLinkPayment = { id: string; amountPaise: bigint; capturedAt: Date; status: string };
export type RazorpayLink = { id: string; shortUrl: string; status: RazorpayLinkStatus; amountPaise: bigint; payments: RazorpayLinkPayment[] };

export type NewLink = {
  amountPaise: bigint;
  description: string;
  referenceId: string; // our payment_links.id
  customer: { name: string; contact?: string };
  notes: Record<string, string>;
};

export interface RazorpayClient {
  verify(): Promise<void>;
  createLink(link: NewLink): Promise<RazorpayLink>;
  fetchLink(id: string): Promise<RazorpayLink>;
  cancelLink(id: string): Promise<void>;
}

// auth: the keys were refused. network: Razorpay couldn't be reached. api: anything else.
export class RazorpayError extends Error {
  constructor(
    readonly kind: "auth" | "network" | "api",
    message: string,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

export type RazorpayApi = (keys: Pick<RazorpayCredentials, "keyId" | "keySecret">) => RazorpayClient;

const BASE = "https://api.razorpay.com/v1";

type WireLink = { id: string; short_url: string; status: RazorpayLinkStatus; amount: number; payments?: { payment_id: string; amount: number; created_at: number; status: string }[] | null };

const fromWire = (l: WireLink): RazorpayLink => ({
  id: l.id,
  shortUrl: l.short_url,
  status: l.status,
  amountPaise: BigInt(l.amount),
  payments: (l.payments ?? []).map((p) => ({ id: p.payment_id, amountPaise: BigInt(p.amount), capturedAt: new Date(p.created_at * 1000), status: p.status })),
});

export const httpRazorpay: RazorpayApi = ({ keyId, keySecret }) => {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: { authorization: auth, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new RazorpayError("network", "Couldn't reach Razorpay");
    }
    if (res.status === 401) throw new RazorpayError("auth", "Razorpay didn't accept these keys");
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) throw new RazorpayError("api", json.error?.description ?? `Razorpay answered ${res.status}`);
    return json;
  }
  return {
    async verify() {
      await call("GET", "/payments?count=1");
    },
    async createLink(link) {
      return fromWire(
        await call<WireLink>("POST", "/payment_links", {
          amount: Number(link.amountPaise),
          currency: "INR",
          accept_partial: false,
          description: link.description,
          reference_id: link.referenceId,
          customer: link.customer,
          notify: { sms: false, email: false }, // staff share it themselves (docs/03 §9)
          reminder_enable: false,
          notes: link.notes,
        }),
      );
    },
    async fetchLink(id) {
      return fromWire(await call<WireLink>("GET", `/payment_links/${encodeURIComponent(id)}`));
    },
    async cancelLink(id) {
      await call("POST", `/payment_links/${encodeURIComponent(id)}/cancel`);
    },
  };
};
