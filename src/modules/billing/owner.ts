import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { getOwnTenant, listBranches, tenantToday } from "@/modules/tenancy/repo";
import {
  activityStudentCounts,
  type BillPayment,
  getBillingSettings,
  getInvoice,
  getSubscription,
  type ListedPayment,
  listInvoices,
  listPayments,
  liveSubscriptions,
  openBalances,
  paymentsForBill,
  staffCounts,
  staffSeats,
  type SubscriptionRow,
  usageKey,
} from "./repo";
import type { BillingInvoice } from "./schema";
import { dueToStart } from "./service";

// The academy's own Billing page (agreed 2026-09-30). Everything is read
// through its transaction, so row-level security keeps it to this academy;
// staff kept to some branches see those branches only.

// duePaise: what paying now takes. The first period while waiting, else what
// its bills still owe; nothing on trial.
export type OwnerModule = SubscriptionRow & { students: number; duePaise: bigint };
export type OwnerBranch = { id: string; name: string; isDefault: boolean; modules: OwnerModule[] };
export type BillingPageData = {
  today: string;
  branches: OwnerBranch[];
  staff: number;
  staffLimit: number | null; // its plans' seats plus one owner; null = no limit
  bills: BillingInvoice[];
  payments: ListedPayment[];
  howToPay: string | null;
};

export async function billingPage(tx: Tx, ctx: ScopedCtx): Promise<BillingPageData> {
  assertCan(ctx, "billing:view");
  const mine = (branchId: string) => !ctx.branchIds.length || ctx.branchIds.includes(branchId);
  const ids = [ctx.tenantId];
  const [today, branches, subs, students, staff, seats, owed, settings] = [
    await tenantToday(tx),
    (await listBranches(tx)).filter((b) => mine(b.id)).sort((x, y) => Number(y.isDefault) - Number(x.isDefault)), // the first branch first
    await liveSubscriptions(tx),
    await activityStudentCounts(tx, { tenantIds: ids }),
    await staffCounts(tx, ids),
    await staffSeats(tx, { tenantIds: ids }),
    await openBalances(tx, ids),
    await getBillingSettings(tx),
  ];
  const due = (s: SubscriptionRow) => (s.status === "pending" ? dueToStart(s, settings.taxRateBp, today) : s.status === "trial" ? 0n : (owed.get(s.id) ?? 0n));
  const seat = seats.get(ctx.tenantId);
  const shown = new Set(subs.filter((s) => mine(s.branchId)).map((s) => s.id));
  return {
    today,
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      isDefault: b.isDefault,
      modules: subs.filter((s) => s.branchId === b.id).map((s) => ({ ...s, students: students.get(usageKey(b.id, s.activityKey)) ?? 0, duePaise: due(s) })),
    })),
    staff: staff.get(ctx.tenantId) ?? 0,
    staffLimit: seat === null ? null : (seat ?? 0) + 1,
    bills: (await listInvoices(tx, { tenantIds: ids })).filter((i) => shown.has(i.subscriptionId)),
    payments: (await listPayments(tx, { tenantIds: ids })).filter((p) => shown.has(p.subscriptionId)),
    howToPay: settings.howToPay,
  };
}

export type BillPageData = { today: string; bill: BillingInvoice; payments: BillPayment[]; academy: { name: string; gstin: string | null } };

// One bill, to read or print; another academy's (or another branch's, for
// staff kept to some branches) is not found.
export async function billPage(tx: Tx, ctx: ScopedCtx, invoiceId: string): Promise<BillPageData> {
  assertCan(ctx, "billing:view");
  const bill = await getInvoice(tx, invoiceId);
  const sub = bill ? await getSubscription(tx, bill.subscriptionId) : undefined;
  if (!bill || !sub || (ctx.branchIds.length && !ctx.branchIds.includes(sub.branchId))) throw new NotFoundError("Bill");
  const tenant = await getOwnTenant(tx);
  return { today: await tenantToday(tx), bill, payments: await paymentsForBill(tx, bill.id), academy: { name: tenant?.name ?? "", gstin: tenant?.gstin ?? null } };
}
