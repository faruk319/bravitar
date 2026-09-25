import type { Tx } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { getInvoice } from "@/modules/fees/repo";
import { type InvoiceDetail, invoiceView } from "@/modules/fees/service";
import { razorpayConnected } from "@/modules/integrations/service";
import { linkForInvoice } from "@/modules/payments/links";
import { getPayment } from "@/modules/payments/repo";
import { type Receipt, receiptOf } from "@/modules/payments/service";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { resolveShareLink, type Shared } from "./links";
import type { ShareKind } from "./schema";

// A private link opens only on its own academy's address (docs/03 §10).
async function open<T>(token: string, hostSlug: string | undefined, kind: ShareKind, read: (s: Shared, tx: Tx) => Promise<T | undefined>): Promise<T | undefined> {
  const s = await resolveShareLink(token);
  if (!s || s.kind !== kind || !hostSlug) return undefined;
  return withTenant(s.tenantId, async (tx) => ((await getOwnTenant(tx))?.slug === hostSlug ? read(s, tx) : undefined));
}

export async function sharedReceipt(token: string, hostSlug: string | undefined): Promise<Receipt | undefined> {
  return open(token, hostSlug, "receipt", async (s, tx) => {
    const p = await getPayment(tx, [], s.entityId);
    return p ? receiptOf(tx, p) : undefined;
  });
}

export type SharedInvoice = InvoiceDetail & { payOnline: boolean };

export async function sharedInvoice(token: string, hostSlug: string | undefined): Promise<SharedInvoice | undefined> {
  return open(token, hostSlug, "invoice", async (s, tx) => {
    const inv = await getInvoice(tx, [], s.entityId);
    if (!inv || inv.status === "draft") return undefined;
    const due = (inv.status === "issued" || inv.status === "part_paid") && inv.totalPaise > inv.paidPaise;
    return { ...(await invoiceView(tx, inv)), payOnline: due && (await razorpayConnected(tx)) };
  });
}

// "Pay online": the invoice's Razorpay link, made or reused for its balance.
export async function payOnlineUrl(token: string, hostSlug: string | undefined): Promise<string | undefined> {
  return open(token, hostSlug, "invoice", async (s, tx) => {
    const inv = await getInvoice(tx, [], s.entityId);
    return inv ? (await linkForInvoice(tx, { actorType: "system", tenantId: s.tenantId }, inv)).url : undefined;
  });
}
