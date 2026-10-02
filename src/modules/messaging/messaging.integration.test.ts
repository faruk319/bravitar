import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { saveAttendance } from "@/modules/attendance/service";
import { addHoliday, addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { generateInvoices } from "@/modules/fees/invoicing";
import { invoices } from "@/modules/fees/schema";
import { createPlan, issueInvoices } from "@/modules/fees/service";
import { recordPayment } from "@/modules/payments/service";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { getDefaultBranch } from "@/modules/tenancy/repo";
import { tenants } from "@/modules/tenancy/schema";
import { testAcademy } from "@/lib/db/isolation/academy";
import { sharedInvoice, sharedReceipt } from "./public";
import { type ComposeRequest, composeMessage } from "./compose";

const stamp = Math.random().toString(36).slice(2, 8);
const slug = `msg-${stamp}`;
const at = (s: string) => new Date(s);
let T = "";
let owner: ScopedCtx;
let teacher: ScopedCtx;
let desk: ScopedCtx;
let batchId = "";
let householdId = "";
let riya = "";
let kabir = "";
let invoiceId = "";
let paymentId = "";

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const compose = (req: ComposeRequest, ctx: ScopedCtx = owner, now = at("2026-10-10T06:00:00Z")) => withTenant(T, (tx) => composeMessage(tx, ctx, req, { now }));
const tokenOf = (url: string, kind: "i" | "r") => url.match(new RegExp(`/${kind}/([A-Za-z0-9_-]+)`))?.[1] ?? "";
const classOn = async (date: string) => (await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batchId), eq(sessions.sessionDate, date)))))[0]?.id ?? "";

beforeAll(async () => {
  const t = await testAcademy({ name: `Msg Academy ${stamp}`, slug, verticalPreset: "karate", owner: { name: "Owner", email: `msg-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  owner = await ctxFor(t.owner.id);
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  const hire = async (name: string, role: string) => ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleId: roles[role] ?? "" }))).id);
  teacher = await hire("teacher", "Teacher");
  desk = await hire("desk", "Front Desk");

  const program = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  const plan = (await withTenant(T, (tx) => createPlan(tx, owner, { name: "Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "80000" }))).id;
  batchId = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Evening", programId: program, slots: [1, 3, 5].map((weekday) => ({ weekday, startTime: "18:00", endTime: "19:00" })), startDate: "2026-10-01", defaultFeePlanId: plan }))).id;
  await withTenant(T, (tx) => reconcileSessions(tx, { now: at("2026-09-30T18:30:00Z"), batchIds: [batchId] }));

  const phone = `+9195${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;
  const first = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Riya", guardian: { fullName: "Sunita Sharma", phone, relation: "mother" }, consents: { dataProcessing: true } }));
  householdId = first.household.id;
  riya = first.student.id;
  kabir = (await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Kabir", guardian: { fullName: "Sunita Sharma", phone, relation: "mother" }, householdId, consents: { dataProcessing: true } }))).student.id;
  const joined = [await withTenant(T, (tx) => enroll(tx, owner, { studentId: riya, batchId, startDate: "2026-10-01" })), await withTenant(T, (tx) => enroll(tx, owner, { studentId: kabir, batchId, startDate: "2026-10-01" }))];
  await withTenant(T, (tx) => generateInvoices(tx, { actorType: "system", tenantId: T }, { now: at("2026-10-01T04:00:00Z"), enrollmentIds: joined.map((e) => e.id) }));
  const [draft] = await withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.householdId, householdId)));
  invoiceId = draft?.id ?? "";
  await withTenant(T, (tx) => issueInvoices(tx, owner, [invoiceId], { now: at("2026-10-01T04:00:00Z") }));
  const branch = await withTenant(T, getDefaultBranch);
  paymentId = (await withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId, branchId: branch?.id ?? "", amountPaise: "50000" }))).id;
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("copy-message flow (Prompt 17 step 1)", () => {
  it("a fee reminder names the children, the balance, the due date and a private link, for the primary guardian", async () => {
    const m = await compose({ key: "fee_overdue", invoiceId });
    expect(m.drafts).toHaveLength(1);
    const d = m.drafts[0];
    expect(d?.to[0]).toMatchObject({ name: "Sunita Sharma" });
    expect(d?.text).toContain("Hello Sunita Sharma, Kabir and Riya's fee of ₹1,100");
    expect(d?.text).toContain("was due on 8 Oct 2026");
    expect(d?.text).toMatch(new RegExp(`http://${slug}\\.localhost:3000/i/[A-Za-z0-9_-]{40,} Thank you\\.$`));
  });

  it("the private invoice link opens only on its own academy's address", async () => {
    const token = tokenOf((await compose({ key: "fee_due", invoiceId })).drafts[0]?.text ?? "", "i");
    const shown = await sharedInvoice(token, slug);
    expect(shown).toMatchObject({ invoice: { id: invoiceId, paidPaise: 50000n }, payOnline: false });
    expect(await sharedInvoice(token, "someone-else")).toBeUndefined();
    expect(await sharedInvoice(token, undefined)).toBeUndefined();
    expect(await sharedInvoice(`${token.slice(0, -2)}xx`, slug)).toBeUndefined();
    expect(await sharedReceipt(token, slug)).toBeUndefined(); // an invoice token isn't a receipt
  });

  it("a receipt message carries the number, the amount and its own link", async () => {
    const text = (await compose({ key: "receipt", paymentId })).drafts[0]?.text ?? "";
    expect(text).toContain("received ₹500");
    const shown = await sharedReceipt(tokenOf(text, "r"), slug);
    expect(text).toContain(shown?.payment.receiptNumber ?? "missing");
    expect(shown?.payment.amountPaise).toBe(50000n);
  });

  it("absent, welcome and class cancelled read from the class and the family", async () => {
    const monday = await classOn("2026-10-05");
    await withTenant(T, (tx) =>
      saveAttendance(tx, owner, monday, { marks: [{ studentId: riya, status: "absent" }, { studentId: kabir, status: "present" }] }, { now: at("2026-10-05T14:00:00Z") }),
    );
    const absent = await compose({ key: "absent", sessionId: monday, studentId: riya }, owner, at("2026-10-05T14:00:00Z"));
    expect(absent.drafts[0]?.text).toBe(`Hello Sunita Sharma, Riya was absent from Evening at Msg Academy ${stamp} on 5 Oct 2026. Please let us know if anything is wrong.`);
    await expect(compose({ key: "absent", sessionId: monday, studentId: kabir }, owner, at("2026-10-05T14:00:00Z"))).rejects.toThrow("Not marked absent");

    expect((await compose({ key: "welcome", studentId: kabir })).drafts[0]?.text).toBe(`Welcome to Msg Academy ${stamp}, Sunita Sharma! Kabir has joined us. We're glad to have you.`);

    await expect(compose({ key: "class_cancelled", sessionId: monday })).rejects.toThrow("isn't cancelled");
    await withTenant(T, (tx) => addHoliday(tx, owner, { date: "2026-10-07", name: "Dussehra" }));
    const cancelled = await compose({ key: "class_cancelled", sessionId: await classOn("2026-10-07") });
    expect(cancelled.drafts.map((d) => d.about).sort()).toEqual(["Kabir", "Riya"]);
    expect(cancelled.drafts[0]?.text).toContain("Evening class at");
    expect(cancelled.drafts[0]?.text).toContain("on 7 Oct 2026 at 18:00 is cancelled.");
  });

  it("the academy's language picks the wording", async () => {
    await withTenant(T, (tx) => tx.update(tenants).set({ messageLanguage: "hi" }).where(eq(tenants.id, T)));
    expect((await compose({ key: "welcome", studentId: riya })).drafts[0]?.text).toContain("में आपका स्वागत है");
    await withTenant(T, (tx) => tx.update(tenants).set({ messageLanguage: "en" }).where(eq(tenants.id, T)));
  });

  it("needs messages:send: a Teacher and the default Front Desk can't compose", async () => {
    await expect(compose({ key: "welcome", studentId: riya }, teacher)).rejects.toMatchObject({ status: 403 });
    await expect(compose({ key: "fee_due", invoiceId }, desk)).rejects.toMatchObject({ status: 403 });
  });
});
