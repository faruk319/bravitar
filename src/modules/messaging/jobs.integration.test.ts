import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { formatPaise } from "@/lib/money/format";
import { saveAttendance } from "@/modules/attendance/service";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { generateInvoices } from "@/modules/fees/invoicing";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { createPlan, issueInvoices } from "@/modules/fees/service";
import { fakeWhatsapp } from "@/modules/integrations/fake-whatsapp";
import { connectWhatsapp } from "@/modules/integrations/service";
import { cancelPayment, recordGatewayPayment, recordPayment } from "@/modules/payments/service";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { runMessagesRemind, runMessagesSend, sendDue } from "./job";
import { sharedInvoice } from "./public";
import { type MessageLog, messageLog } from "./schema";
import { messageLogView, saveMessagingSettings, saveTemplate } from "./service";

// docs/06 Prompt 17 step 4 and the docs/03 §10 acceptance list: the hourly
// reminder job and the every-minute send job, at the academy's hours.

const stamp = Math.random().toString(36).slice(2, 8);
const slug = `jobs-${stamp}`;
const ist = (date: string, time: string) => localToUtc(date, time, "Asia/Kolkata");
const wa = fakeWhatsapp();
const SUNITA = "+919500000001"; // Riya and Kabir's mother, opted in
const SANA = "+919500000002"; // Zoya's mother, not opted in
const MEHER = "+919500000003"; // an adult student, her own contact, opted in
let T = "";
let owner: ScopedCtx;
let branchId = "";
let batchId = "";
const family: Record<"sharma" | "shaikh" | "meher", string> = { sharma: "", shaikh: "", meher: "" };
const kids: Record<"riya" | "kabir" | "zoya" | "meher", string> = { riya: "", kabir: "", zoya: "", meher: "" };
const bill: Record<string, Invoice> = {};

const remind = (now: Date) => runMessagesRemind({ now, tenantIds: [T] });
const log = () => withTenant(T, (tx) => tx.select().from(messageLog).orderBy(asc(messageLog.createdAt), asc(messageLog.id)));
const reload = async (id: string) => (await log()).find((m) => m.id === id) as MessageLog;
const classOn = async (date: string) => (await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batchId), eq(sessions.sessionDate, date)))))[0]?.id ?? "";
const mark = (date: string, at: Date, marks: [keyof typeof kids, "present" | "absent"][]) =>
  classOn(date).then((id) => withTenant(T, (tx) => saveAttendance(tx, owner, id, { marks: marks.map(([k, status]) => ({ studentId: kids[k], status })) }, { now: at })));
const absentOn = async (date: string) => (await log()).filter((m) => m.dedupeKey?.startsWith("absent|") && m.dedupeKey.endsWith(date));

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Jobs ${stamp}`, slug, verticalPreset: "karate", owner: { name: "Owner", email: `jobs-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  branchId = t.branch.id;
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, t.owner.id), await staffBranchIds(tx, t.owner.id)] as const);
  owner = { ...base, branchIds };

  const program = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  const plan = (await withTenant(T, (tx) => createPlan(tx, owner, { name: "Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "80000" }))).id;
  batchId = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Evening", programId: program, slots: [1, 3, 5].map((weekday) => ({ weekday, startTime: "18:00", endTime: "19:00" })), startDate: "2026-10-01", defaultFeePlanId: plan }))).id;
  await withTenant(T, (tx) => reconcileSessions(tx, { now: ist("2026-10-01", "00:00"), batchIds: [batchId] }));

  const admit = (fullName: string, contact: object, whatsapp: boolean) => withTenant(T, (tx) => createStudent(tx, owner, { fullName, ...contact, consents: { dataProcessing: true, whatsapp } }));
  const riya = await admit("Riya", { guardian: { fullName: "Sunita Sharma", phone: SUNITA, relation: "mother" } }, true);
  family.sharma = riya.household.id;
  kids.riya = riya.student.id;
  kids.kabir = (await admit("Kabir", { guardian: { fullName: "Sunita Sharma", phone: SUNITA, relation: "mother" }, householdId: family.sharma }, true)).student.id;
  const zoya = await admit("Zoya", { guardian: { fullName: "Sana Shaikh", phone: SANA, relation: "mother" } }, false);
  [family.shaikh, kids.zoya] = [zoya.household.id, zoya.student.id];
  const meher = await admit("Meher Kaur", { dateOfBirth: "1998-05-05", adultPhone: MEHER }, true);
  [family.meher, kids.meher] = [meher.household.id, meher.student.id];

  const joined: string[] = [];
  for (const id of Object.values(kids)) joined.push((await withTenant(T, (tx) => enroll(tx, owner, { studentId: id, batchId, startDate: "2026-10-01" }))).id);
  await withTenant(T, (tx) => generateInvoices(tx, { actorType: "system", tenantId: T }, { now: ist("2026-10-01", "09:30"), enrollmentIds: joined }));
  await withTenant(T, (tx) => issueInvoices(tx, owner, "all", { now: ist("2026-10-01", "09:30") }));
  for (const inv of await withTenant(T, (tx) => tx.select().from(invoices))) bill[inv.householdId] = inv; // each due 8 Oct
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("messages.remind: fee reminders (agreed 2026-09-25)", () => {
  it("fee_due goes 3 days before, from the send hour, to each family's opted-in primary guardian, once, with a link", async () => {
    await remind(ist("2026-10-05", "09:30"));
    expect(await log()).toHaveLength(0);
    await remind(ist("2026-10-05", "10:00"));
    await remind(ist("2026-10-05", "11:00"));
    const due = (await log()).filter((m) => m.templateKey === "fee_due");
    expect(due.map((m) => m.toPhone).sort()).toEqual([SUNITA, MEHER]); // Zoya's mother never opted in

    const sharma = bill[family.sharma] as Invoice;
    const m = due.find((x) => x.toPhone === SUNITA);
    expect(m).toMatchObject({ channel: "manual", status: "queued", relatedType: "invoice", relatedId: sharma.id, sendAfter: ist("2026-10-05", "10:00") });
    expect(m?.body).toContain(`Kabir and Riya's fee of ${formatPaise(sharma.totalPaise)}`);
    expect(m?.body).toContain("is due on 8 Oct 2026");
    const token = m?.body.match(/\/i\/([A-Za-z0-9_-]+) Thank you\.$/)?.[1] ?? "";
    expect((await sharedInvoice(token, slug))?.invoice.id).toBe(sharma.id);

    const toSend = await withTenant(T, (tx) => messageLogView(tx, owner, "to_send", { now: ist("2026-10-05", "11:00") }));
    expect(toSend.messages.map((x) => x.id)).toEqual(expect.arrayContaining(due.map((x) => x.id)));
  });

  it("fee_overdue goes 1 and 7 days after, each once, catching up after a missed day; nothing after two weeks", async () => {
    for (const day of ["2026-10-10", "2026-10-12", "2026-10-15", "2026-10-22"]) await remind(ist(day, "10:30"));
    const stages = (await log()).filter((m) => m.templateKey === "fee_overdue" && m.toPhone === SUNITA).map((m) => m.dedupeKey?.split("|")[2]);
    expect(stages).toEqual(["1", "7"]);
  });
});

describe("payments: receipts and the reminders they settle", () => {
  it("a desk payment skips the queued reminders it paid; its receipt waits for 07:00 when paid late at night", async () => {
    const inv = bill[family.meher] as Invoice;
    const pay = await withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId: family.meher, branchId, amountPaise: String(inv.totalPaise) }, { now: ist("2026-10-22", "22:30") }));
    const mine = (await log()).filter((m) => m.toPhone === MEHER);
    expect(mine.filter((m) => m.relatedId === inv.id).map((m) => [m.status, m.error])).toEqual([
      ["skipped", "A payment came in first"],
      ["skipped", "A payment came in first"],
      ["skipped", "A payment came in first"],
    ]);
    const receipt = mine.find((m) => m.templateKey === "receipt");
    expect(receipt).toMatchObject({ status: "queued", relatedId: pay.id, sendAfter: ist("2026-10-23", "07:00") });
    expect(receipt?.body).toContain(pay.receiptNumber);

    await withTenant(T, (tx) => cancelPayment(tx, owner, pay.id, { reason: "Wrong family" }, { now: ist("2026-10-22", "22:40") }));
    expect(await reload(receipt?.id ?? "")).toMatchObject({ status: "skipped", error: "The payment was cancelled" });
  });

  it("a Razorpay payment queues its receipt at once during the day", async () => {
    const inv = bill[family.sharma] as Invoice;
    const g = await withTenant(T, (tx) => recordGatewayPayment(tx, { invoiceId: inv.id, gatewayPaymentId: `pay_${stamp}`, amountPaise: 50000n, capturedAt: ist("2026-10-23", "12:00") }, { now: ist("2026-10-23", "12:00") }));
    expect((await log()).find((m) => m.relatedId === g.payment.id)).toMatchObject({ templateKey: "receipt", toPhone: SUNITA, status: "queued", sendAfter: ist("2026-10-23", "12:00") });
    expect((await log()).filter((m) => m.relatedId === inv.id && m.status === "queued")).toHaveLength(0);
  });
});

describe("messages.remind: absences", () => {
  it("from the evening hour, one per absent child, not for an adult; a corrected mark is skipped", async () => {
    await mark("2026-10-26", ist("2026-10-26", "18:30"), [
      ["riya", "absent"],
      ["kabir", "absent"],
      ["zoya", "present"],
      ["meher", "absent"],
    ]);
    await remind(ist("2026-10-26", "18:30"));
    expect(await absentOn("2026-10-26")).toHaveLength(0);
    await remind(ist("2026-10-26", "19:00"));
    const absent = await absentOn("2026-10-26");
    expect(absent.map((m) => m.variables.student_name).sort()).toEqual(["Kabir", "Riya"]);
    expect(absent.find((m) => m.variables.student_name === "Riya")?.body).toBe(`Hello Sunita Sharma, Riya was absent from Evening at Jobs ${stamp} on 26 Oct 2026. Please let us know if anything is wrong.`);

    await mark("2026-10-26", ist("2026-10-26", "19:30"), [["kabir", "present"]]);
    await remind(ist("2026-10-26", "20:00"));
    const after = await absentOn("2026-10-26");
    expect(after.map((m) => [m.variables.student_name, m.status, m.error]).sort()).toEqual([
      ["Kabir", "skipped", "No longer marked absent"],
      ["Riya", "queued", null],
    ]);
  });
});

describe("messages.send: through WhatsApp at the academy's hours", () => {
  it("one message a day per guardian and category, receipts aside; the daily cap and quiet hours hold the rest", async () => {
    await withTenant(T, (tx) => connectWhatsapp(tx, owner, { phoneNumberId: "100000000000009", accessToken: "EAAG-fake-access-token", appSecret: "0123456789abcdef0123456789abcdef" }, { api: wa.api }));
    for (const key of ["fee_due", "fee_overdue", "receipt", "absent"] as const) await withTenant(T, (tx) => saveTemplate(tx, owner, key, { providerTemplateName: `${key}_v1` }));

    await mark("2026-11-02", ist("2026-11-02", "18:30"), [
      ["riya", "absent"],
      ["kabir", "absent"],
    ]);
    await remind(ist("2026-11-02", "19:00"));
    expect((await absentOn("2026-11-02")).map((m) => m.channel)).toEqual(["whatsapp", "whatsapp"]);
    expect(await sendDue(T, { now: ist("2026-11-02", "19:00"), api: wa.api })).toMatchObject({ sent: 1, deferred: 1 });
    const held = (await absentOn("2026-11-02")).find((m) => m.status === "queued");
    expect(held?.sendAfter).toEqual(ist("2026-11-03", "19:00"));
    expect(wa.sent.at(-1)).toMatchObject({ to: SUNITA, templateName: "absent_v1", parameters: ["Sunita Sharma", expect.any(String), "Evening", `Jobs ${stamp}`, "2 Nov 2026"] });

    // A receipt is not held back by the day's absence message.
    await withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId: family.sharma, branchId, amountPaise: "10000" }, { now: ist("2026-11-02", "19:05") }));
    expect(await sendDue(T, { now: ist("2026-11-02", "19:05"), api: wa.api })).toMatchObject({ sent: 1 });

    // With the day's cap at 2, Meher's receipt moves to tomorrow 07:00.
    await withTenant(T, (tx) => saveMessagingSettings(tx, owner, { language: "en", sendHour: 10, absenceHour: 19, dailyCap: 2 }));
    const other = await withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId: family.meher, branchId, amountPaise: "10000" }, { now: ist("2026-11-02", "19:10") }));
    expect(await sendDue(T, { now: ist("2026-11-02", "19:10"), api: wa.api })).toMatchObject({ sent: 0, deferred: 1 });
    const waiting = (await log()).find((m) => m.relatedId === other.id) as MessageLog;
    expect(waiting).toMatchObject({ status: "queued", sendAfter: ist("2026-11-03", "07:00") });

    // Quiet hours: a message due at night waits for 07:00.
    await withTenant(T, (tx) => tx.update(messageLog).set({ sendAfter: ist("2026-11-02", "21:00") }).where(eq(messageLog.id, waiting.id)));
    expect(await sendDue(T, { now: ist("2026-11-02", "21:30"), api: wa.api })).toMatchObject({ sent: 0, deferred: 0 });
    expect(await sendDue(T, { now: ist("2026-11-03", "06:59"), api: wa.api })).toMatchObject({ sent: 0, deferred: 0 });
    expect(await runMessagesSend({ now: ist("2026-11-03", "07:00"), api: wa.api, tenantIds: [T] })).toMatchObject({ sent: 1 });
    expect(await reload(waiting.id)).toMatchObject({ status: "sent", sentAt: ist("2026-11-03", "07:00") });
    expect((await reload(held?.id ?? "")).status).toBe("queued"); // its turn is 19:00
  });
});
