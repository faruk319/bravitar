import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { guardiansOfStudent } from "@/modules/students/repo";
import type { Guardian } from "@/modules/students/schema";
import { createStudent, setGuardianWhatsapp } from "@/modules/students/service";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { messageLog } from "./schema";
import { composeMessage, messageAction, messageLogView, messageTemplates, messagingSettings, queueMessage, saveMessagingSettings, saveTemplate } from "./service";

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let owner: ScopedCtx;
let teacher: ScopedCtx;
let desk: ScopedCtx;
let phone = 0;
let kid = "";
let yes: Guardian; // opted in at admission
let no: Guardian;

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const admit = async (name: string, whatsapp?: boolean) => {
  const r = await withTenant(T, (tx) =>
    createStudent(tx, owner, { fullName: name, guardian: { fullName: `Parent of ${name}`, phone: `+9194${String(10_000_000 + ++phone)}`, relation: "father" }, consents: { dataProcessing: true, ...(whatsapp === undefined ? {} : { whatsapp }) } }),
  );
  return { studentId: r.student.id, guardian: (await withTenant(T, (tx) => guardiansOfStudent(tx, r.student.id)))[0] as Guardian };
};
const queue = (guardian: Guardian, dedupeKey?: string, key: "absent" | "welcome" = "absent") =>
  withTenant(T, (tx) => queueMessage(tx, T, { key, guardian, vars: { student_name: "Riya", batch: "Evening", date: "5 Oct 2026" }, ...(dedupeKey ? { dedupeKey } : {}) }));
const actions = async (id: string) => (await withTenant(T, (tx) => tx.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, id)))).map((r) => r.a).sort();

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Log ${stamp}`, slug: `log-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `log-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  owner = await ctxFor(t.owner.id);
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  const hire = async (name: string, role: string) => ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleIds: [roles[role] ?? ""] }))).id);
  teacher = await hire("teacher", "Teacher");
  desk = await hire("desk", "Front Desk");
  const a = await admit("Riya", true);
  kid = a.studentId;
  yes = a.guardian;
  no = (await admit("Kabir")).guardian;
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("templates (docs/03 §10: editable, on/off)", () => {
  it("the academy's wording is used; unknown variables are refused; reset brings the default back", async () => {
    await withTenant(T, (tx) => saveTemplate(tx, owner, "welcome", { body: "Namaste {{guardian_name}}, {{student_name}} ab {{academy}} mein hai." }));
    const text = async () => (await withTenant(T, (tx) => composeMessage(tx, owner, { key: "welcome", studentId: kid }))).drafts[0]?.text;
    expect(await text()).toBe(`Namaste Parent of Riya, Riya ab Log ${stamp} mein hai.`);
    await expect(withTenant(T, (tx) => saveTemplate(tx, owner, "welcome", { body: "Hello {{amount}}, welcome!" }))).rejects.toThrow("can't use {{amount}}");
    const reset = await withTenant(T, (tx) => saveTemplate(tx, owner, "welcome", { reset: true }));
    expect(reset).toMatchObject({ isDefault: true, isActive: true });
    expect(await text()).toBe(`Welcome to Log ${stamp}, Parent of Riya! Riya has joined us. We're glad to have you.`);
    expect((await withTenant(T, (tx) => messageTemplates(tx, owner))).map((t) => t.key)).toEqual(["fee_due", "fee_overdue", "receipt", "absent", "class_cancelled", "welcome"]);
    await expect(withTenant(T, (tx) => saveTemplate(tx, desk, "welcome", { isActive: false }))).rejects.toMatchObject({ status: 403 });
  });

  it("turning a template off stops its automated messages at once", async () => {
    await withTenant(T, (tx) => saveTemplate(tx, owner, "absent", { isActive: false }));
    expect(await queue(yes, "off-test")).toBeUndefined();
    await withTenant(T, (tx) => saveTemplate(tx, owner, "absent", { isActive: true }));
    expect(await queue(yes, "off-test")).toMatchObject({ status: "queued" });
  });
});

describe("WhatsApp opt-in (agreed 2026-09-25: off until ticked)", () => {
  it("a tick at admission opts the guardian in; staff switch it later, audited", async () => {
    expect([yes.whatsappOptin, no.whatsappOptin]).toEqual([true, false]);
    const on = await withTenant(T, (tx) => setGuardianWhatsapp(tx, owner, no.id, true));
    expect(on.whatsappOptinAt).toBeInstanceOf(Date);
    await withTenant(T, (tx) => setGuardianWhatsapp(tx, owner, no.id, false));
    expect(await actions(no.id)).toEqual(["guardian.whatsapp_optin", "guardian.whatsapp_optout"]);
    await expect(withTenant(T, (tx) => setGuardianWhatsapp(tx, teacher, no.id, true))).rejects.toMatchObject({ status: 403 });
  });

  it("only opted-in guardians get automated messages, and a repeat key makes nothing", async () => {
    expect(await queue({ ...no, whatsappOptin: false }, "k1")).toBeUndefined();
    const m = await queue(yes, "absent|riya|2026-10-05");
    expect(m).toMatchObject({ status: "queued", channel: "manual", category: "attendance", toPhone: yes.phone, body: `Hello Parent of Riya, Riya was absent from Evening at Log ${stamp} today (5 Oct 2026). Please let us know if anything is wrong.` });
    expect(await queue(yes, "absent|riya|2026-10-05")).toBeUndefined();
  });
});

describe("the log and the To send list", () => {
  it("with no WhatsApp connected, messages wait under To send until sent by hand or skipped; failed ones retry", async () => {
    const [a, b, c] = [await queue(yes, "to-send-1"), await queue(yes, "to-send-2"), await queue(yes, "to-send-3")];
    const toSend = await withTenant(T, (tx) => messageLogView(tx, owner, "to_send"));
    expect(toSend.messages.map((m) => m.id)).toEqual(expect.arrayContaining([a?.id, b?.id, c?.id]));
    expect(toSend.messages.find((m) => m.id === a?.id)?.guardianName).toBe("Parent of Riya");

    await withTenant(T, (tx) => messageAction(tx, owner, a?.id ?? "", "sent"));
    await withTenant(T, (tx) => messageAction(tx, owner, b?.id ?? "", "skip"));
    const sent = await withTenant(T, (tx) => messageLogView(tx, owner, "sent"));
    expect(sent.messages.filter((m) => m.id === a?.id || m.id === b?.id).map((m) => [m.status, m.sentBy])).toEqual(
      expect.arrayContaining([
        ["sent", owner.staffId],
        ["skipped", owner.staffId],
      ]),
    );
    await expect(withTenant(T, (tx) => messageAction(tx, owner, a?.id ?? "", "sent"))).rejects.toThrow("waiting to be sent by hand");

    await withTenant(T, (tx) => tx.update(messageLog).set({ status: "failed", error: "Number not on WhatsApp", attempts: 1 }).where(eq(messageLog.id, c?.id ?? "")));
    const failed = await withTenant(T, (tx) => messageLogView(tx, owner, "failed"));
    expect(failed.messages.find((m) => m.id === c?.id)?.error).toBe("Number not on WhatsApp");
    await withTenant(T, (tx) => messageAction(tx, owner, c?.id ?? "", "retry"));
    expect((await withTenant(T, (tx) => messageLogView(tx, owner, "to_send"))).messages.map((m) => m.id)).toContain(c?.id);
  });

  it("the log needs messages:read, and acting on it messages:send", async () => {
    await expect(withTenant(T, (tx) => messageLogView(tx, teacher, "to_send"))).rejects.toMatchObject({ status: 403 });
    const m = await queue(yes, "perm-1");
    await expect(withTenant(T, (tx) => messageAction(tx, desk, m?.id ?? "", "sent"))).rejects.toMatchObject({ status: 403 });
  });
});

describe("messaging settings", () => {
  it("language, send hours and the daily cap are saved; hours outside 7–21 are refused", async () => {
    expect(await withTenant(T, (tx) => messagingSettings(tx, owner))).toEqual({ language: "en", sendHour: 10, absenceHour: 19, dailyCap: 250 });
    await withTenant(T, (tx) => saveMessagingSettings(tx, owner, { language: "mr", sendHour: 11, absenceHour: 18, dailyCap: 100 }));
    expect(await withTenant(T, (tx) => messagingSettings(tx, owner))).toEqual({ language: "mr", sendHour: 11, absenceHour: 18, dailyCap: 100 });
    await expect(withTenant(T, (tx) => saveMessagingSettings(tx, owner, { language: "en", sendHour: 23, absenceHour: 18, dailyCap: 100 }))).rejects.toThrow();
    await expect(withTenant(T, (tx) => saveMessagingSettings(tx, desk, { language: "en", sendHour: 10, absenceHour: 19, dailyCap: 250 }))).rejects.toMatchObject({ status: 403 });
    await withTenant(T, (tx) => saveMessagingSettings(tx, owner, { language: "en", sendHour: 10, absenceHour: 19, dailyCap: 250 }));
  });
});
