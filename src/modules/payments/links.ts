import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { formatPaise } from "@/lib/money/format";
import type { Paise } from "@/lib/money/paise";
import { getInvoice } from "@/modules/fees/repo";
import type { Invoice } from "@/modules/fees/schema";
import type { Actor } from "@/modules/fees/invoicing";
import { httpRazorpay, type RazorpayApi } from "@/modules/integrations/razorpay";
import { razorpayKeys, razorpayMessage } from "@/modules/integrations/service";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { closeLink, familyContact, insertLink, liveLink, lockFamily } from "./repo";
import type { PaymentLink } from "./schema";

export type LinkShare = { url: string; amountPaise: Paise; invoiceNumber: string; phone: string | null; message: string; reused: boolean };

const share = (l: PaymentLink, number: string, academy: string, phone: string | null, reused: boolean): LinkShare => ({
  url: l.shortUrl,
  amountPaise: l.amountPaise,
  invoiceNumber: number,
  phone,
  message: `${academy}: fees of ${formatPaise(l.amountPaise)} for invoice ${number}. Pay online here: ${l.shortUrl}`,
  reused,
});

// docs/03 §9 (agreed 2026-09-25): a Razorpay link from the academy's own account
// for the invoice's balance, paid in full. One live link per invoice: the same
// balance reuses it; a changed balance cancels it in Razorpay and makes a new one.
// Staff share it themselves; nothing is sent from here.
export async function paymentLinkFor(tx: Tx, ctx: ScopedCtx, invoiceId: string, opts: { api?: RazorpayApi; now?: Date } = {}): Promise<LinkShare> {
  assertCan(ctx, "fees:collect");
  const found = await getInvoice(tx, ctx.branchIds, invoiceId);
  if (!found) throw new NotFoundError("Invoice");
  return linkForInvoice(tx, { actorType: "staff", actorId: ctx.staffId, tenantId: ctx.tenantId }, found, opts);
}

// Also used by "Pay online" on the family's private invoice link (docs/03 §10).
export async function linkForInvoice(tx: Tx, actor: Actor, found: Invoice, opts: { api?: RazorpayApi; now?: Date } = {}): Promise<LinkShare> {
  const keys = await razorpayKeys(tx);
  if (!keys) throw new ConflictError("Connect Razorpay in Settings first");
  // The balance can't move while the link is made.
  await lockFamily(tx, found.householdId);
  const inv = (await getInvoice(tx, [], found.id)) ?? found;
  if (inv.status !== "issued" && inv.status !== "part_paid") throw new ConflictError("Only an unpaid invoice can have a payment link");
  const balance = inv.totalPaise - inv.paidPaise;
  const number = inv.number ?? "";
  const [tenant, contact] = await Promise.all([getOwnTenant(tx), familyContact(tx, inv.householdId)]);
  const academy = tenant?.name ?? "";
  const now = opts.now ?? new Date();
  const api = (opts.api ?? httpRazorpay)(keys);

  const live = await liveLink(tx, inv.id);
  if (live && live.amountPaise === balance) return share(live, number, academy, contact.phone, true);
  if (live) {
    try {
      await api.cancelLink(live.gatewayLinkId);
    } catch (e) {
      // Most often it was paid a moment ago and the webhook is on its way.
      throw new ConflictError(`The last link for this invoice couldn't be cancelled (${razorpayMessage(e)}). If the family just paid, the payment will show here shortly.`);
    }
    await closeLink(tx, live.id, "cancelled", now);
    await writeAudit(tx, { ...actor, action: "payment_link.cancel", entityType: "invoice", entityId: inv.id, after: { linkId: live.id, gatewayLinkId: live.gatewayLinkId, reason: "balance changed" } });
  }

  const id = uuidv7();
  let made: Awaited<ReturnType<typeof api.createLink>>;
  try {
    made = await api.createLink({
      amountPaise: balance,
      description: `${academy} · ${number}`,
      referenceId: id,
      customer: { name: contact.name, ...(contact.phone ? { contact: contact.phone } : {}) },
      notes: { tenant_id: actor.tenantId, invoice_id: inv.id, link_id: id },
    });
  } catch (e) {
    throw new BadRequestError(razorpayMessage(e));
  }
  const link = await insertLink(tx, { id, tenantId: actor.tenantId, invoiceId: inv.id, gatewayLinkId: made.id, shortUrl: made.shortUrl, amountPaise: balance, createdBy: actor.actorId ?? null, createdAt: now });
  await writeAudit(tx, { ...actor, action: "payment_link.create", entityType: "invoice", entityId: inv.id, after: { linkId: id, gatewayLinkId: made.id, amountPaise: String(balance) } });
  return share(link, number, academy, contact.phone, false);
}
