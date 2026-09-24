import { type NewLink, type RazorpayApi, RazorpayError, type RazorpayLink } from "./razorpay";

// Tests only: an in-memory Razorpay account. Keys other than `secret` are refused;
// `down` makes it unreachable; `pay` marks a link paid as if a parent had paid it.
export type FakeRazorpay = {
  api: RazorpayApi;
  links: Map<string, RazorpayLink & { request: NewLink }>;
  pay: (linkId: string, paymentId: string, at?: Date) => void;
  down: boolean;
  calls: string[];
};

export function fakeRazorpay(secret = "secret-ok"): FakeRazorpay {
  let n = 0;
  const fake: FakeRazorpay = {
    links: new Map(),
    down: false,
    calls: [],
    pay(linkId, paymentId, at = new Date()) {
      const l = fake.links.get(linkId);
      if (!l) throw new Error(`fake: no link ${linkId}`);
      l.status = "paid";
      l.payments.push({ id: paymentId, amountPaise: l.amountPaise, capturedAt: at, status: "captured" });
    },
    api: ({ keySecret }) => {
      const guard = (what: string) => {
        fake.calls.push(what);
        if (fake.down) throw new RazorpayError("network", "Couldn't reach Razorpay");
        if (keySecret !== secret) throw new RazorpayError("auth", "Razorpay didn't accept these keys");
      };
      return {
        async verify() {
          guard("verify");
        },
        async createLink(request) {
          guard("createLink");
          const id = `plink_fake${++n}`;
          const link = { id, shortUrl: `https://rzp.io/i/fake${n}`, status: "created" as const, amountPaise: request.amountPaise, payments: [], request };
          fake.links.set(id, link);
          return { ...link, payments: [] };
        },
        async fetchLink(id) {
          guard("fetchLink");
          const l = fake.links.get(id);
          if (!l) throw new RazorpayError("api", "The id provided does not exist");
          return { id: l.id, shortUrl: l.shortUrl, status: l.status, amountPaise: l.amountPaise, payments: [...l.payments] };
        },
        async cancelLink(id) {
          guard("cancelLink");
          const l = fake.links.get(id);
          if (!l) throw new RazorpayError("api", "The id provided does not exist");
          if (l.status !== "created") throw new RazorpayError("api", `Link is ${l.status}`);
          l.status = "cancelled";
        },
      };
    },
  };
  return fake;
}
