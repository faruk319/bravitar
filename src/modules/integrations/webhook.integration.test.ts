import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { allocateNumber } from "@/modules/numbering/repo";
import { paymentLinkFor } from "@/modules/payments/links";
import { paymentLinks, payments, refunds } from "@/modules/payments/schema";
import { cancelPayment, collectionSheet, familyAccount, recordPayment, refundPayment } from "@/modules/payments/service";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createHousehold } from "@/modules/students/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { fakeRazorpay } from "./fake-razorpay";
import { razorpayWebhookRoute } from "./routes";
import { webhookEvents } from "./schema";
import { connectRazorpay } from "./service";

// docs/04 test list, Razorpay: the webhook (signature first, once per event,
// either order, one academy only), through the real route handler.

const stamp = Math.random().toString(36).slice(2, 8);
const made: string[] = [];
const rzp = fakeRazorpay();
const NOW = new Date("2026-09-25T06:00:00Z");
const AT = Math.floor(NOW.getTime() / 1000) - 60; // captured a minute ago
type Academy = { id: string; slug: string; branch: string; owner: ScopedCtx; secret: string };
const A = { id: "", slug: `whk-a-${stamp}`, branch: "", secret: "whsec-a-111111" } as Academy;
const B = { id: "", slug: `whk-b-${stamp}`, branch: "", secret: "whsec-b-222222" } as Academy;
let evt = 0;
let pay = 0;

const setUp = async (x: Academy) => {
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Webhook ${x.slug}`, slug: x.slug, owner: { name: "Owner", email: `${x.slug}@example.test` } });
  made.push(t.tenant.id);
  x.id = t.tenant.id;
  x.branch = t.branch.id;
  const [base, branchIds] = await withTenant(x.id, async (tx) => [await loadAccessContext(tx, t.owner.id), await staffBranchIds(tx, t.owner.id)] as const);
  x.owner = { ...base, branchIds };
  await withTenant(x.id, (tx) => connectRazorpay(tx, x.owner, { keyId: "rzp_test_Webhook12345", keySecret: "secret-ok", webhookSecret: x.secret }, { api: rzp.api }));
};
const bill = (x: Academy, rupees: number): Promise<Invoice> =>
  withTenant(x.id, async (tx) => {
    const h = await createHousehold(tx, { tenantId: x.id, name: `Family ${++evt}` });
    const total = BigInt(rupees) * 100n;
    const inv = await insertInvoice(tx, { tenantId: x.id, branchId: x.branch, householdId: h.id, issueDate: "2026-09-01", dueDate: "2026-09-10", subtotalPaise: total, totalPaise: total });
    return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, x.id, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: NOW });
  });
const linkFor = async (x: Academy, inv: Invoice) => {
  await withTenant(x.id, (tx) => paymentLinkFor(tx, x.owner, inv.id, { api: rzp.api, now: NOW }));
  const [l] = await withTenant(x.id, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.invoiceId, inv.id)).orderBy(paymentLinks.createdAt));
  if (!l) throw new Error("no link");
  return l;
};

const payment = (id: string, amount: number, notes: Record<string, string> | [] = []) => ({ id, entity: "payment", amount, currency: "INR", status: "captured", method: "upi", created_at: AT, notes });
const linkPaid = (l: { gatewayLinkId: string; id: string; invoiceId: string }, tenantId: string, payId: string, amount: number, over: { referenceId?: string; linkId?: string } = {}) => ({
  entity: "event",
  event: "payment_link.paid",
  contains: ["payment_link", "order", "payment"],
  payload: {
    payment_link: { entity: { id: over.linkId ?? l.gatewayLinkId, reference_id: over.referenceId ?? l.id, status: "paid", amount, amount_paid: amount, notes: { tenant_id: tenantId, invoice_id: l.invoiceId, link_id: l.id } } },
    payment: { entity: payment(payId, amount) },
    order: { entity: { id: "order_test" } },
  },
  created_at: AT,
});
const captured = (payId: string, amount: number, notes: Record<string, string> | [] = []) => ({ entity: "event", event: "payment.captured", contains: ["payment"], payload: { payment: { entity: payment(payId, amount, notes) } }, created_at: AT });
const refunded = (refundId: string, payId: string, amount: number) => ({
  entity: "event",
  event: "refund.processed",
  contains: ["refund", "payment"],
  payload: { refund: { entity: { id: refundId, payment_id: payId, amount, status: "processed", created_at: AT } }, payment: { entity: payment(payId, amount) } },
  created_at: AT,
});

// Signed with `secret` unless a signature is given; posted to /api/webhooks/razorpay/<slug>.
const deliver = async (slug: string, body: unknown, secret: string, opts: { eventId?: string; signature?: string | null; raw?: string } = {}) => {
  const raw = opts.raw ?? JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json", "x-razorpay-event-id": opts.eventId ?? `evt_${stamp}_${++evt}` };
  const sig = opts.signature === undefined ? createHmac("sha256", secret).update(raw).digest("hex") : opts.signature;
  if (sig !== null) headers["x-razorpay-signature"] = sig;
  const res = await razorpayWebhookRoute(new Request(`http://${slug}.localhost:3000/api/webhooks/razorpay/${slug}`, { method: "POST", headers, body: raw }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const paymentsFor = (x: Academy, gatewayPaymentId: string) => withTenant(x.id, (tx) => tx.select().from(payments).where(eq(payments.gatewayPaymentId, gatewayPaymentId)));
const invoiceOf = async (x: Academy, id: string) => (await withTenant(x.id, (tx) => tx.select().from(invoices).where(eq(invoices.id, id))))[0];
const events = (x: Academy) => withTenant(x.id, (tx) => tx.select().from(webhookEvents));

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  await setUp(A);
  await setUp(B);
});

afterAll(async () => {
  await deleteTenantsCompletely(made);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the Razorpay webhook", () => {
  it("a paid link becomes one payment: online, numbered, the invoice paid, the link closed", async () => {
    const inv = await bill(A, 1500);
    const l = await linkFor(A, inv);
    const payId = `pay_${stamp}_${++pay}`;
    expect(await deliver(A.slug, linkPaid(l, A.id, payId, 150000), A.secret)).toEqual({ status: 200, body: { ok: true } });
    const [p] = await paymentsFor(A, payId);
    expect(p).toMatchObject({ method: "online", amountPaise: 150000n, receivedBy: null, reference: payId, status: "confirmed" });
    expect(p?.receiptNumber).toMatch(/^RCT\/2026-27\/\d{4}$/);
    expect(await invoiceOf(A, inv.id)).toMatchObject({ status: "paid", paidPaise: 150000n });
    const [link] = await withTenant(A.id, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.id, l.id)));
    expect(link?.status).toBe("paid");
    const sheet = await withTenant(A.id, (tx) => collectionSheet(tx, A.owner, { branchId: A.branch, day: p?.recordedOn ?? "" }));
    expect(sheet.byCollector.find((c) => c.name === "Online")?.totalPaise).toBeGreaterThanOrEqual(150000n);
  });

  it("a bad or missing signature is refused and nothing is stored", async () => {
    const inv = await bill(A, 500);
    const l = await linkFor(A, inv);
    const body = linkPaid(l, A.id, `pay_${stamp}_${++pay}`, 50000);
    const before = (await events(A)).length;
    expect((await deliver(A.slug, body, "not-the-secret")).status).toBe(400);
    expect((await deliver(A.slug, body, A.secret, { signature: null })).status).toBe(400);
    const signedOther = createHmac("sha256", A.secret).update(JSON.stringify(body)).digest("hex");
    expect((await deliver(A.slug, body, A.secret, { signature: signedOther, raw: JSON.stringify({ ...body, event: "payment.failed" }) })).status).toBe(400);
    expect((await events(A)).length).toBe(before);
    expect((await invoiceOf(A, inv.id))?.status).toBe("issued");
  });

  it("the same event twice is one payment", async () => {
    const inv = await bill(A, 700);
    const l = await linkFor(A, inv);
    const payId = `pay_${stamp}_${++pay}`;
    const eventId = `evt_${stamp}_dup`;
    expect((await deliver(A.slug, linkPaid(l, A.id, payId, 70000), A.secret, { eventId })).body).toEqual({ ok: true });
    expect((await deliver(A.slug, linkPaid(l, A.id, payId, 70000), A.secret, { eventId })).body).toEqual({ duplicate: true });
    expect(await paymentsFor(A, payId)).toHaveLength(1);
  });

  it("payment.captured before payment_link.paid is still one payment", async () => {
    const inv = await bill(A, 900);
    const l = await linkFor(A, inv);
    const payId = `pay_${stamp}_${++pay}`;
    expect((await deliver(A.slug, captured(payId, 90000, { tenant_id: A.id, invoice_id: inv.id, link_id: l.id }), A.secret)).body).toEqual({ ok: true });
    expect(await paymentsFor(A, payId)).toHaveLength(1);
    // Answered 200, not a failure Razorpay would retry for a day.
    expect(await deliver(A.slug, linkPaid(l, A.id, payId, 90000), A.secret)).toEqual({ status: 200, body: { ok: true } });
    expect(await paymentsFor(A, payId)).toHaveLength(1);
    expect(await invoiceOf(A, inv.id)).toMatchObject({ status: "paid", paidPaise: 90000n });
  });

  it("payment.captured without our notes waits for payment_link.paid", async () => {
    const inv = await bill(A, 400);
    const l = await linkFor(A, inv);
    const payId = `pay_${stamp}_${++pay}`;
    expect((await deliver(A.slug, captured(payId, 40000), A.secret)).status).toBe(200);
    expect(await paymentsFor(A, payId)).toHaveLength(0);
    await deliver(A.slug, linkPaid(l, A.id, payId, 40000), A.secret);
    expect(await paymentsFor(A, payId)).toHaveLength(1);
  });

  it("academy A's webhook can't create a payment in academy B", async () => {
    const theirs = await bill(B, 1000);
    const bLink = await linkFor(B, theirs);
    const payId = `pay_${stamp}_${++pay}`;
    // Signed with A's secret, sent to A, naming B's link and invoice.
    const r = await deliver(A.slug, linkPaid(bLink, B.id, payId, 100000), A.secret);
    expect(r).toEqual({ status: 200, body: { ok: true, note: "the link names another academy" } });
    const spoofed = await deliver(A.slug, linkPaid({ ...bLink }, A.id, payId, 100000), A.secret);
    expect(spoofed.body.note).toBe("no invoice here for this link");
    // Signed with A's secret, sent to B.
    expect((await deliver(B.slug, linkPaid(bLink, B.id, payId, 100000), A.secret)).status).toBe(400);
    expect(await paymentsFor(B, payId)).toHaveLength(0);
    expect(await paymentsFor(A, payId)).toHaveLength(0);
    expect((await invoiceOf(B, theirs.id))?.status).toBe("issued");
  });

  it("paying more than the balance keeps the rest as the family's advance", async () => {
    const inv = await bill(A, 1500);
    const l = await linkFor(A, inv);
    await withTenant(A.id, (tx) => recordPayment(tx, A.owner, { requestId: uuidv7(), householdId: inv.householdId, branchId: A.branch, amountPaise: "50000" }));
    const payId = `pay_${stamp}_${++pay}`;
    await deliver(A.slug, linkPaid(l, A.id, payId, 150000), A.secret); // the old link, for the full ₹1,500
    expect(await invoiceOf(A, inv.id)).toMatchObject({ status: "paid", paidPaise: 150000n });
    expect((await withTenant(A.id, (tx) => familyAccount(tx, A.owner, inv.householdId, A.branch))).advancePaise).toBe(50000n);
  });

  it("a malformed reference id falls back to the link's notes", async () => {
    const inv = await bill(A, 300);
    const l = await linkFor(A, inv);
    const payId = `pay_${stamp}_${++pay}`;
    expect((await deliver(A.slug, linkPaid(l, A.id, payId, 30000, { referenceId: "not-a-uuid", linkId: "plink_unknown" }), A.secret)).body).toEqual({ ok: true });
    expect(await paymentsFor(A, payId)).toHaveLength(1);
  });

  it("refund.processed records the refund once and reopens the invoice; staff can't refund or cancel online payments", async () => {
    const inv = await bill(A, 1200);
    const l = await linkFor(A, inv);
    const payId = `pay_${stamp}_${++pay}`;
    await deliver(A.slug, linkPaid(l, A.id, payId, 120000), A.secret);
    const [p] = await paymentsFor(A, payId);
    await expect(withTenant(A.id, (tx) => refundPayment(tx, A.owner, p?.id ?? "", { amountPaise: "10000", reason: "Asked" }))).rejects.toThrow("refunded in your Razorpay dashboard");
    await expect(withTenant(A.id, (tx) => cancelPayment(tx, A.owner, p?.id ?? "", { reason: "Mistake" }))).rejects.toThrow("refunded in your Razorpay dashboard");
    const refundId = `rfnd_${stamp}_${pay}`;
    expect((await deliver(A.slug, refunded(refundId, payId, 20000), A.secret)).body).toEqual({ ok: true });
    expect(await deliver(A.slug, refunded(refundId, payId, 20000), A.secret)).toEqual({ status: 200, body: { ok: true } }); // a new event id, the same refund
    const rows = await withTenant(A.id, (tx) => tx.select().from(refunds).where(eq(refunds.paymentId, p?.id ?? "")));
    expect(rows.map((r) => [r.amountPaise, r.method, r.gatewayRefundId, r.approvedBy])).toEqual([[20000n, "online", refundId, null]]);
    expect(await invoiceOf(A, inv.id)).toMatchObject({ status: "part_paid", paidPaise: 100000n });
  });

  it("an unknown academy, one without Razorpay, and a signed non-event are refused", async () => {
    expect((await deliver(`nobody-${stamp}`, captured("pay_x", 100), A.secret)).status).toBe(404);
    const c = await createTenantWithDefaults({ actorType: "system" }, { name: `Webhook C ${stamp}`, slug: `whk-c-${stamp}`, owner: { name: "Owner", email: `whk-c-${stamp}@example.test` } });
    made.push(c.tenant.id);
    expect((await deliver(`whk-c-${stamp}`, captured("pay_x", 100), A.secret)).status).toBe(404);
    expect((await deliver(A.slug, { hello: "world" }, A.secret)).status).toBe(400);
    expect((await deliver(A.slug, null, A.secret, { raw: "not json" })).status).toBe(400);
  });
});
