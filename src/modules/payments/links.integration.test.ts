import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { voidInvoice } from "@/modules/fees/service";
import { fakeRazorpay } from "@/modules/integrations/fake-razorpay";
import { connectRazorpay } from "@/modules/integrations/service";
import { allocateNumber } from "@/modules/numbering/repo";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { reconcileLinks, runPaymentsReconcile } from "./job";
import { paymentLinkFor } from "./links";
import { paymentLinks, payments } from "./schema";
import { recordPayment } from "./service";

// docs/04 test list, Razorpay: payment links (docs/03 §9, agreed 2026-09-25).

const stamp = Math.random().toString(36).slice(2, 8);
const made: string[] = [];
const rzp = fakeRazorpay();
let T = "";
let U = ""; // an academy that never connected Razorpay
let main = "";
let mainU = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let teacher: ScopedCtx;
let ownerU: ScopedCtx;
let phone = 0;

const academy = async (key: string) => {
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Links ${key} ${stamp}`, slug: `lnk-${key}-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `lnk-${key}-${stamp}@example.test` } });
  made.push(t.tenant.id);
  return t;
};
const ctxFor = async (tenant: string, staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(tenant, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const family = async (tenant = T, ctx = owner) => {
  const r = await withTenant(tenant, (tx) =>
    createStudent(tx, ctx, { fullName: `Kid ${++phone}`, guardian: { fullName: `Parent ${phone}`, phone: `+9198${String(10_000_000 + phone)}`, relation: "mother" }, consents: { dataProcessing: true } }),
  );
  return r.household.id;
};
const bill = (householdId: string, rupees: number, tenant = T, status: "issued" | "draft" = "issued"): Promise<Invoice> =>
  withTenant(tenant, async (tx) => {
    const total = BigInt(rupees) * 100n;
    const inv = await insertInvoice(tx, { tenantId: tenant, branchId: tenant === T ? main : mainU, householdId, issueDate: "2026-09-01", dueDate: "2026-09-10", subtotalPaise: total, totalPaise: total });
    return status === "draft" ? inv : updateInvoice(tx, inv.id, { number: await allocateNumber(tx, tenant, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
  });
const link = (invoiceId: string, as: ScopedCtx = desk, tenant = T) => withTenant(tenant, (tx) => paymentLinkFor(tx, as, invoiceId, { api: rzp.api }));
const linksOf = (invoiceId: string) => withTenant(T, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.invoiceId, invoiceId)).orderBy(paymentLinks.createdAt));

beforeAll(async () => {
  const t = await academy("t");
  T = t.tenant.id;
  main = t.branch.id;
  owner = await ctxFor(T, t.owner.id);
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  const hire = async (name: string, role: string) => ctxFor(T, (await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleIds: [roles[role] ?? ""] }))).id);
  desk = await hire("desk", "Front Desk");
  teacher = await hire("coach", "Teacher");
  await withTenant(T, (tx) => connectRazorpay(tx, owner, { keyId: "rzp_test_Links123456", keySecret: "secret-ok", webhookSecret: "whsec-links" }, { api: rzp.api }));
  const u = await academy("u");
  U = u.tenant.id;
  mainU = u.branch.id;
  ownerU = await ctxFor(U, u.owner.id);
});

afterAll(async () => {
  await deleteTenantsCompletely(made);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("payment links", () => {
  it("are for the balance, paid in full, from the academy's own account, for the family's guardian", async () => {
    const h = await family();
    const inv = await bill(h, 1500);
    const share = await link(inv.id);
    expect(share).toMatchObject({ amountPaise: 150000n, invoiceNumber: inv.number, reused: false });
    expect(share.phone).toMatch(/^\+9198/);
    expect(share.message).toContain(share.url);
    const [row] = await linksOf(inv.id);
    const sent = rzp.links.get(row?.gatewayLinkId ?? "")?.request;
    expect(sent).toMatchObject({ amountPaise: 150000n, referenceId: row?.id, customer: { contact: share.phone }, notes: { tenant_id: T, invoice_id: inv.id, link_id: row?.id } });
  });

  it("the same balance reuses the live link; a changed balance cancels it and makes a new one", async () => {
    const h = await family();
    const inv = await bill(h, 1500);
    const first = await link(inv.id);
    expect(await link(inv.id)).toMatchObject({ url: first.url, reused: true });
    await withTenant(T, (tx) => recordPayment(tx, desk, { requestId: uuidv7(), householdId: h, branchId: main, amountPaise: "50000" }));
    const second = await link(inv.id);
    expect(second).toMatchObject({ amountPaise: 100000n, reused: false });
    expect(second.url).not.toBe(first.url);
    const rows = await linksOf(inv.id);
    expect(rows.map((r) => r.status)).toEqual(["cancelled", "created"]);
    expect(rzp.links.get(rows[0]?.gatewayLinkId ?? "")?.status).toBe("cancelled");
  });

  it("won't replace a link Razorpay says is already paid", async () => {
    const h = await family();
    const inv = await bill(h, 1500);
    await link(inv.id);
    const [row] = await linksOf(inv.id);
    rzp.pay(row?.gatewayLinkId ?? "", `pay_${stamp}a`);
    await withTenant(T, (tx) => recordPayment(tx, desk, { requestId: uuidv7(), householdId: h, branchId: main, amountPaise: "10000" }));
    await expect(link(inv.id)).rejects.toThrow("couldn't be cancelled");
    expect((await linksOf(inv.id)).map((r) => r.status)).toEqual(["created"]);
  });

  it("only for an unpaid invoice", async () => {
    const h = await family();
    const draft = await bill(h, 500, T, "draft");
    const paid = await bill(h, 500);
    await withTenant(T, (tx) => recordPayment(tx, desk, { requestId: uuidv7(), householdId: h, branchId: main, amountPaise: "50000", allocations: [{ invoiceId: paid.id, amountPaise: "50000" }] }));
    const voided = await bill(h, 500);
    await withTenant(T, (tx) => voidInvoice(tx, owner, voided.id, { reason: "Wrong plan" }));
    for (const inv of [draft, paid, voided]) await expect(link(inv.id)).rejects.toThrow("Only an unpaid invoice");
    const [p] = await withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.id, paid.id)));
    expect(p?.status).toBe("paid");
  });

  it("need fees:collect, and an academy that connected Razorpay", async () => {
    const inv = await bill(await family(), 800);
    await expect(link(inv.id, teacher)).rejects.toMatchObject({ status: 403 });
    const other = await bill(await family(U, ownerU), 800, U);
    await expect(link(other.id, ownerU, U)).rejects.toThrow("Connect Razorpay in Settings first");
  });

  it("another academy's invoice is not found", async () => {
    const other = await bill(await family(U, ownerU), 800, U);
    await expect(link(other.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("the hourly check for lost webhooks", () => {
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
  const reconcile = (minutes: number) => withTenant(T, (tx) => reconcileLinks(tx, { api: rzp.api, now: later(minutes) }));

  it("records a link paid while its webhook was lost, once, and closes it", async () => {
    const inv = await bill(await family(), 1100);
    await link(inv.id);
    const [row] = await linksOf(inv.id);
    rzp.pay(row?.gatewayLinkId ?? "", `pay_lost_${stamp}`);
    const first = await reconcile(31);
    expect(first.recorded).toBeGreaterThanOrEqual(1);
    const [p] = await withTenant(T, (tx) => tx.select().from(payments).where(eq(payments.gatewayPaymentId, `pay_lost_${stamp}`)));
    expect(p).toMatchObject({ method: "online", amountPaise: 110000n });
    const [inv2] = await withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.id, inv.id)));
    expect(inv2?.status).toBe("paid");
    expect((await linksOf(inv.id)).map((l) => l.status)).toEqual(["paid"]);
    expect((await reconcile(90)).recorded).toBe(0);
  });

  it("leaves links younger than 30 minutes alone, and closes ones Razorpay cancelled", async () => {
    const inv = await bill(await family(), 600);
    await link(inv.id);
    const [row] = await linksOf(inv.id);
    const calls = rzp.calls.length;
    await reconcile(5);
    expect(rzp.calls.slice(calls)).not.toContain("fetchLink");
    const l = rzp.links.get(row?.gatewayLinkId ?? "");
    if (l) l.status = "expired";
    await reconcile(45);
    expect((await linksOf(inv.id)).map((x) => x.status)).toEqual(["expired"]);
  });

  it("keeps going when Razorpay can't be reached, and runs per academy", async () => {
    const inv = await bill(await family(), 650);
    await link(inv.id);
    rzp.down = true;
    const r = await reconcile(40);
    rzp.down = false;
    expect(r.unreachable).toBeGreaterThanOrEqual(1);
    expect((await linksOf(inv.id)).map((x) => x.status)).toEqual(["created"]);
    const run = await runPaymentsReconcile({ api: rzp.api, now: later(40), tenantIds: [T, U] });
    expect(run).toMatchObject({ tenants: 2, ok: 2, failed: [] });
  });
});
