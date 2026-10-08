import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { allocateNumber } from "@/modules/numbering/repo";
import { recordPayment } from "@/modules/payments/service";
import { localToUtc } from "@/modules/sessions/occurrences";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createGuardian, linkGuardian, updateGuardian } from "@/modules/students/repo";
import { createStudent } from "@/modules/students/service";
import { tenantToday } from "@/modules/tenancy/repo";
import { composeMessage } from "./compose";
import { queueReminders } from "./reminders";
import { messageLog } from "./schema";

// A message about an invoice or payment goes to its payer, not to the member's primary guardian.

const stamp = Math.random().toString(36).slice(2, 8);
const MOTHER = "+919500100001"; // the member's primary guardian, opted in
const FATHER = "+919500100002"; // pays, opted in
const ADULT = "+919500100003"; // an adult member who pays for themselves
let riya = "";
let T = "";
let owner: ScopedCtx;
let branchId = "";
let today = "";
let now = new Date();
const bill: Record<"father" | "adult", { id: string }> = { father: { id: "" }, adult: { id: "" } };
const log = () => withTenant(T, (tx) => tx.select().from(messageLog).orderBy(asc(messageLog.createdAt), asc(messageLog.id)));

const invoiceFor = (payer: { payerGuardianId: string } | { payerMemberId: string }, studentId: string, rupees: number) =>
  withTenant(T, async (tx) => {
    const total = BigInt(rupees) * 100n;
    const due = addDays(today, 3);
    const inv = await insertInvoice(tx, { tenantId: T, branchId, studentId, ...payer, billToName: "Payer", issueDate: addDays(due, -7), dueDate: due, subtotalPaise: total, totalPaise: total });
    return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
  });

beforeAll(async () => {
  const t = await testAcademy({ name: `Payer msgs ${stamp}`, slug: `payer-msgs-${stamp}`, owner: { name: "Owner", email: `payer-msgs-${stamp}@example.test` } });
  T = t.tenant.id;
  branchId = t.branch.id;
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, t.owner.id), await staffBranchIds(tx, t.owner.id)] as const);
  owner = { ...base, branchIds };
  today = await withTenant(T, tenantToday);
  now = localToUtc(today, "12:00", "Asia/Kolkata");

  const kid = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Riya", guardian: { fullName: "Sunita Sharma", phone: MOTHER, relation: "mother" }, consents: { dataProcessing: true, whatsapp: true } }));
  riya = kid.student.id;
  const father = await withTenant(T, async (tx) => {
    const g = await createGuardian(tx, { tenantId: T, fullName: "Imran Sharma", phone: FATHER });
    await linkGuardian(tx, T, kid.student.id, g.id, "father");
    return updateGuardian(tx, g.id, { whatsappOptin: true });
  });
  const adult = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Meher Kaur", dateOfBirth: "1998-05-05", adultPhone: ADULT, consents: { dataProcessing: true, whatsapp: true } }));
  bill.father = await invoiceFor({ payerGuardianId: father.id }, kid.student.id, 800);
  bill.adult = await invoiceFor({ payerMemberId: adult.student.id }, adult.student.id, 900);
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("messages follow the payer", () => {
  it("a fee reminder goes to the guardian who pays, or to a member paying for themselves", async () => {
    expect(await withTenant(T, (tx) => queueReminders(tx, { now }))).toMatchObject({ fees: 2 });
    const byInvoice = Object.fromEntries((await log()).map((m) => [m.relatedId, m.toPhone]));
    expect(byInvoice).toEqual({ [bill.father.id]: FATHER, [bill.adult.id]: ADULT });
  });

  it("the fee draft for staff is addressed to the payer", async () => {
    const c = await withTenant(T, (tx) => composeMessage(tx, owner, { key: "fee_due", invoiceId: bill.father.id }, { now }));
    expect(c.drafts[0]?.to).toEqual([{ name: "Imran Sharma", phone: FATHER }]);
  });

  it("a receipt is queued for the payer of what it paid", async () => {
    await withTenant(T, async (tx) => recordPayment(tx, owner, { requestId: uuidv7(), memberId: riya, branchId, amountPaise: "80000", method: "cash", allocations: [{ invoiceId: bill.father.id, amountPaise: "80000" }] }, { now }));
    const receipts = (await log()).filter((m) => m.templateKey === "receipt");
    expect(receipts.map((m) => m.toPhone)).toEqual([FATHER]);
  });
});
