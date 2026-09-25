import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { fakeWhatsapp } from "@/modules/integrations/fake-whatsapp";
import { tenantIntegrations, webhookEvents } from "@/modules/integrations/schema";
import { connectWhatsapp, testWhatsapp, whatsappStatus } from "@/modules/integrations/service";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { guardiansOfStudent } from "@/modules/students/repo";
import type { Guardian } from "@/modules/students/schema";
import { createStudent } from "@/modules/students/service";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { adapterFor } from "./adapter";
import { whatsappVerifyRoute, whatsappWebhookRoute } from "./routes";
import { type MessageLog, messageLog } from "./schema";
import { deliverMessage, messageAction, queueMessage, saveTemplate } from "./service";

// docs/06 Prompt 17 step 3: the academy's own number on Meta's Cloud API,
// through a fake Meta, and Meta's webhook through the real route handlers.

const stamp = Math.random().toString(36).slice(2, 8);
const wa = fakeWhatsapp();
const TOKEN = "EAAG-fake-access-token";
const NOW = new Date("2026-10-05T14:00:00Z");
type Academy = { id: string; slug: string; owner: ScopedCtx; phoneId: string; secret: string };
const A = { slug: `wa-a-${stamp}`, phoneId: "100000000000001", secret: "0123456789abcdef0123456789abcdef" } as Academy;
const B = { slug: `wa-b-${stamp}`, phoneId: "100000000000002", secret: "fedcba9876543210fedcba9876543210" } as Academy;
let desk: ScopedCtx;
let guardian: Guardian;

const ctxFor = async (tenantId: string, staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(tenantId, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const setUp = async (x: Academy) => {
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `WA ${x.slug}`, slug: x.slug, verticalPreset: "karate", owner: { name: "Owner", email: `${x.slug}@example.test` } });
  x.id = t.tenant.id;
  x.owner = await ctxFor(x.id, t.owner.id);
};
const connect = (x: Academy, over: { accessToken?: string } = {}, ctx: ScopedCtx = x.owner) =>
  withTenant(x.id, (tx) => connectWhatsapp(tx, ctx, { phoneNumberId: x.phoneId, accessToken: TOKEN, appSecret: x.secret, ...over }, { api: wa.api }));
const queue = async (dedupeKey: string) => {
  const m = await withTenant(A.id, (tx) => queueMessage(tx, A.id, { key: "absent", guardian, vars: { student_name: "Riya", batch: "Evening", date: "5 Oct 2026" }, dedupeKey }));
  if (!m) throw new Error("nothing queued");
  return m;
};
const deliver = (m: MessageLog) => withTenant(A.id, async (tx) => deliverMessage(tx, m, await adapterFor(tx, { api: wa.api }), { now: NOW }));
const reload = async (id: string) => (await withTenant(A.id, (tx) => tx.select().from(messageLog).where(eq(messageLog.id, id))))[0] as MessageLog;
const sent = async (dedupeKey: string) => {
  const m = await deliver(await queue(dedupeKey));
  return { id: m.id, wamid: m.providerMessageId ?? "" };
};

const signed = (x: Academy, body: unknown) => {
  const raw = JSON.stringify(body);
  return { raw, sig: `sha256=${createHmac("sha256", x.secret).update(raw).digest("hex")}` };
};
const post = (slug: string, raw: string, sig: string | null) =>
  whatsappWebhookRoute(new Request(`http://${slug}.localhost:3000/api/webhooks/whatsapp/${slug}`, { method: "POST", body: raw, headers: sig ? { "x-hub-signature-256": sig } : {} }));
const report = (phoneNumberId: string, statuses: object[]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba-1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919820000000", phone_number_id: phoneNumberId }, statuses } }] }],
});
const status = (wamid: string, s: string, extra: object = {}) => ({ id: wamid, status: s, timestamp: "1791200000", recipient_id: "919410000001", ...extra });
const tell = (statuses: object[]) => {
  const { raw, sig } = signed(A, report(A.phoneId, statuses));
  return post(A.slug, raw, sig);
};

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  await setUp(A);
  await setUp(B);
  const roles = Object.fromEntries((await withTenant(A.id, listRoles)).map((r) => [r.name, r.id]));
  desk = await ctxFor(A.id, (await withTenant(A.id, (tx) => createStaffMember(tx, A.owner, { email: `desk-${stamp}@example.test`, fullName: "Desk", roleIds: [roles["Front Desk"] ?? ""] }))).id);
  const r = await withTenant(A.id, (tx) =>
    createStudent(tx, A.owner, { fullName: "Riya", guardian: { fullName: "Parent of Riya", phone: "+919410000001", relation: "father" }, consents: { dataProcessing: true, whatsapp: true } }),
  );
  guardian = (await withTenant(A.id, (tx) => guardiansOfStudent(tx, r.student.id)))[0] as Guardian;
});

afterAll(async () => {
  await deleteTenantsCompletely([A.id, B.id]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("connecting the academy's own number", () => {
  it("keys are checked with Meta first, sealed, and audited without the secrets", async () => {
    await expect(connect(A, { accessToken: "EAAG-some-other-token-1" })).rejects.toThrow("didn't accept this access token");
    expect(await withTenant(A.id, (tx) => whatsappStatus(tx, A.owner))).toMatchObject({ connected: false, verifyToken: null });

    const first = await connect(A);
    expect(first).toMatchObject({ connected: true, phone: "+91 98200 00000", name: "Fake Academy", lastError: null });
    expect(first.verifyToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect((await connect(A)).verifyToken).toBe(first.verifyToken); // Meta keeps the one it was given

    const audit = await withTenant(A.id, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityType, "integration")));
    expect(audit.map((r) => r.action).sort()).toEqual(["integration.connect", "integration.update"]);
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
    expect(JSON.stringify(audit)).not.toContain(A.secret);
    const [row] = await withTenant(A.id, (tx) => tx.select().from(tenantIntegrations).where(eq(tenantIntegrations.kind, "whatsapp")));
    expect(row?.credentials.includes(Buffer.from(TOKEN))).toBe(false);
    await connect(B);
  });

  it("Test connection shows when Meta can't be reached, and clears; only integrations:manage", async () => {
    wa.down = true;
    expect((await withTenant(A.id, (tx) => testWhatsapp(tx, A.owner, { api: wa.api }))).lastError).toBe("Couldn't reach WhatsApp. Try again in a minute.");
    wa.down = false;
    expect((await withTenant(A.id, (tx) => testWhatsapp(tx, A.owner, { api: wa.api }))).lastError).toBeNull();
    await expect(connect(A, {}, desk)).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(A.id, (tx) => whatsappStatus(tx, desk))).rejects.toMatchObject({ status: 403 });
  });
});

describe("sending through Meta", () => {
  it("only a template approved in Meta goes through WhatsApp; the rest wait under To send", async () => {
    expect((await queue("absent-1")).channel).toBe("manual");
    await expect(withTenant(A.id, (tx) => saveTemplate(tx, A.owner, "absent", { providerTemplateName: "Absent Notice" }))).rejects.toThrow("small letters");
    await withTenant(A.id, (tx) => saveTemplate(tx, A.owner, "absent", { providerTemplateName: "absent_notice" }));
    expect((await queue("absent-2")).channel).toBe("whatsapp");
  });

  it("sends the approved template with its variables in Meta's order, and keeps Meta's id", async () => {
    const m = await deliver(await queue("absent-3"));
    expect(m).toMatchObject({ status: "sent", channel: "whatsapp", attempts: 1, error: null, sentAt: NOW });
    expect(m.providerMessageId).toMatch(/^wamid\.fake\d+$/);
    expect(wa.sent.at(-1)).toMatchObject({ to: guardian.phone, templateName: "absent_notice", language: "en", parameters: ["Parent of Riya", "Riya", "Evening", `WA ${A.slug}`, "5 Oct 2026"] });
  });

  it("a number Meta refuses fails with its reason and can be retried; a template turned off is skipped", async () => {
    wa.bad.add(guardian.phone);
    const failed = await deliver(await queue("absent-4"));
    expect(failed).toMatchObject({ status: "failed", attempts: 1, error: "WhatsApp said: Recipient phone number not in allowed list" });
    wa.bad.clear();
    await withTenant(A.id, (tx) => messageAction(tx, A.owner, failed.id, "retry"));
    expect(await deliver(await reload(failed.id))).toMatchObject({ status: "sent", attempts: 2, error: null });

    const waiting = await queue("absent-5");
    await withTenant(A.id, (tx) => saveTemplate(tx, A.owner, "absent", { isActive: false }));
    expect(await deliver(waiting)).toMatchObject({ status: "skipped" });
    await withTenant(A.id, (tx) => saveTemplate(tx, A.owner, "absent", { isActive: true }));
  });

  it("with the Meta name cleared, a waiting message moves to To send", async () => {
    const waiting = await queue("absent-6");
    const before = wa.sent.length;
    await withTenant(A.id, (tx) => saveTemplate(tx, A.owner, "absent", { providerTemplateName: "" }));
    expect(await deliver(waiting)).toMatchObject({ status: "queued", channel: "manual" });
    expect(wa.sent).toHaveLength(before);
    await withTenant(A.id, (tx) => saveTemplate(tx, A.owner, "absent", { providerTemplateName: "absent_notice" }));
  });
});

describe("Meta's webhook", () => {
  it("the setup check echoes the challenge only for the academy's own verify token", async () => {
    const token = (await withTenant(A.id, (tx) => whatsappStatus(tx, A.owner))).verifyToken ?? "";
    const check = (slug: string, t: string) =>
      whatsappVerifyRoute(new Request(`http://${slug}.localhost:3000/api/webhooks/whatsapp/${slug}?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=1158201444`));
    const ok = await check(A.slug, token);
    expect([ok.status, await ok.text()]).toEqual([200, "1158201444"]);
    expect((await check(A.slug, "wrong-token")).status).toBe(403);
    expect((await check(B.slug, token)).status).toBe(403);
  });

  it("the signature is checked first: a bad or missing one, or another academy's secret, changes nothing", async () => {
    const m = await sent("hook-1");
    const { raw, sig } = signed(A, report(A.phoneId, [status(m.wamid, "delivered")]));
    expect((await post(A.slug, raw, sig.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).status).toBe(400);
    expect((await post(A.slug, raw, null)).status).toBe(400);
    expect((await post(B.slug, raw, sig)).status).toBe(400);
    expect((await reload(m.id)).status).toBe("sent");
  });

  it("each report is applied once and only moves forward; a failure carries Meta's reason", async () => {
    const m = await sent("hook-2");
    expect((await tell([status(m.wamid, "delivered")])).status).toBe(200);
    expect((await reload(m.id)).status).toBe("delivered");
    expect(await (await tell([status(m.wamid, "delivered"), status(m.wamid, "read")])).json()).toEqual({ ok: true, duplicates: 1 });
    await tell([status(m.wamid, "sent")]); // late
    expect((await reload(m.id)).status).toBe("read");
    const events = await withTenant(A.id, (tx) => tx.select().from(webhookEvents).where(eq(webhookEvents.provider, "whatsapp")));
    expect(events.filter((e) => e.providerEventId.startsWith(`${m.wamid}:`)).map((e) => e.event).sort()).toEqual(["message.delivered", "message.read", "message.sent"]);

    const f = await sent("hook-3");
    await tell([status(f.wamid, "failed", { errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "The number isn't on WhatsApp" } }] })]);
    expect(await reload(f.id)).toMatchObject({ status: "failed", error: "The number isn't on WhatsApp" });
    expect((await withTenant(A.id, (tx) => whatsappStatus(tx, A.owner))).lastWebhookAt).toBeInstanceOf(Date);
  });

  it("reports for another number are ignored, and anything else is acknowledged", async () => {
    const m = await sent("hook-4");
    const { raw, sig } = signed(A, report("999999999999", [status(m.wamid, "delivered")]));
    expect((await post(A.slug, raw, sig)).status).toBe(200);
    expect((await reload(m.id)).status).toBe("sent");
    const other = signed(A, { object: "page", entry: [] });
    expect(await (await post(A.slug, other.raw, other.sig)).json()).toEqual({ ignored: true });
  });
});
