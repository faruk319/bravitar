import { and, asc, eq, lt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { attendance } from "@/modules/attendance/schema";
import { saveAttendance } from "@/modules/attendance/service";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { insertInvoice, insertLines, updateInvoice } from "@/modules/fees/repo";
import { allocateNumber } from "@/modules/numbering/repo";
import { recordPayment } from "@/modules/payments/service";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { tenantToday } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { sharedInvoice } from "@/modules/messaging/public";
import { childPage, childrenOf, familyReceipts, type GuardianCtx, payLink, portalReceipt } from "./service";

// docs/06 Prompt 20, written before the feature: a parent sees their own
// children and nothing else. Another family's id is a 404, like a missing one.

const stamp = Math.random().toString(36).slice(2, 8);
const TZ = "Asia/Kolkata";
let T = "";
let U = "";
let owner: ScopedCtx;
let a: GuardianCtx;
let b: GuardianCtx;
let aThere: GuardianCtx; // the same parent at a second academy
const kid: Record<string, string> = {};
const receipt: Record<string, string> = {};
let today = "";

const ownerOf = async (tenantId: string, staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(tenantId, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const academy = (name: string) => testAcademy({ name: `${name} ${stamp}`, slug: `${name.toLowerCase()}-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `${name.toLowerCase()}-${stamp}@example.test` } });

beforeAll(async () => {
  const t = await academy("Portal");
  T = t.tenant.id;
  owner = await ownerOf(T, t.owner.id);
  today = await withTenant(T, tenantToday);
  const start = addDays(today, -10);

  // The Deshmukhs have two children here; the Shaikhs one.
  const child = (fullName: string, parent: string, phone: string, householdId?: string) =>
    withTenant(T, (tx) => createStudent(tx, owner, { fullName, guardian: { fullName: parent, phone, relation: "mother" }, ...(householdId ? { householdId } : {}), consents: { dataProcessing: true } }));
  const aarav = await child("Aarav Deshmukh", "Rekha Deshmukh", "98733 10001");
  const anaya = await child("Anaya Deshmukh", "Rekha Deshmukh", "98733 10001", aarav.household.id);
  const zoya = await child("Zoya Shaikh", "Sana Shaikh", "98733 10002");
  Object.assign(kid, { aarav: aarav.student.id, anaya: anaya.student.id, zoya: zoya.student.id });
  a = { tenantId: T, guardianId: aarav.guardian.id };
  b = { tenantId: T, guardianId: zoya.guardian.id };

  // Classes every morning; the teacher marks five of them.
  const program = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  const batch = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Early", programId: program, slots: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "06:00", endTime: "07:00" })), startDate: start }))).id;
  for (const id of Object.values(kid)) await withTenant(T, (tx) => enroll(tx, owner, { studentId: id, batchId: batch, startDate: start }));
  await withTenant(T, (tx) => reconcileSessions(tx, { now: localToUtc(start, "00:00", TZ), batchIds: [batch] }));
  const past = await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batch), lt(sessions.sessionDate, today))).orderBy(asc(sessions.sessionDate)));
  const marks = ["present", "late", "absent", "excused", "present"] as const;
  for (const [i, c] of past.slice(0, 5).entries()) {
    const list = [
      { studentId: kid.aarav ?? "", status: marks[i] ?? "present" },
      { studentId: kid.zoya ?? "", status: "present" as const },
    ];
    await withTenant(T, (tx) => saveAttendance(tx, owner, c.id, { marks: list }, { now: new Date(c.startsAt.getTime() + 3_600_000) }));
  }

  // Each family pays once; the Deshmukhs owe ₹800 on Aarav's invoice.
  const pay = (householdId: string, rupees: number) => withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId, branchId: aarav.student.branchId, amountPaise: String(rupees * 100), method: "cash" }));
  receipt.a = (await pay(aarav.household.id, 500)).id;
  receipt.b = (await pay(zoya.household.id, 300)).id;
  await withTenant(T, async (tx) => {
    const inv = await insertInvoice(tx, { tenantId: T, branchId: aarav.student.branchId, householdId: aarav.household.id, issueDate: today, dueDate: addDays(today, 5), subtotalPaise: 80_000n, totalPaise: 80_000n });
    await insertLines(tx, [{ tenantId: T, invoiceId: inv.id, studentId: kid.aarav ?? "", kind: "tuition", description: "Karate, this month", unitPaise: 80_000n, amountPaise: 80_000n }]);
    await updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
  });

  // Rekha's number is a parent at a second academy too.
  const u = await academy("Other");
  U = u.tenant.id;
  const there = await withTenant(U, async (tx) => createStudent(tx, await ownerOf(U, u.owner.id), { fullName: "Kabir Deshmukh", guardian: { fullName: "Rekha Deshmukh", phone: "98733 10001", relation: "mother" }, consents: { dataProcessing: true } }));
  kid.kabir = there.student.id;
  aThere = { tenantId: U, guardianId: there.guardian.id };
});

afterAll(async () => {
  await deleteTenantsCompletely([T, U]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("security, written first", () => {
  it("guardian A changing an id in the URL gets a 404 for guardian B's child", async () => {
    await expect(withTenant(T, (tx) => childPage(tx, a, kid.zoya ?? ""))).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(T, (tx) => childPage(tx, b, kid.aarav ?? ""))).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(T, (tx) => portalReceipt(tx, a, receipt.b ?? ""))).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(T, (tx) => childPage(tx, a, uuidv7()))).rejects.toMatchObject({ status: 404 });
  });

  it("one phone at two academies: each academy's session reads only its own", async () => {
    await expect(withTenant(T, (tx) => childPage(tx, a, kid.kabir ?? ""))).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(U, (tx) => childPage(tx, aThere, kid.aarav ?? ""))).rejects.toMatchObject({ status: 404 });
    expect((await withTenant(U, (tx) => childrenOf(tx, aThere))).map((c) => c.fullName)).toEqual(["Kabir Deshmukh"]);
    expect(await withTenant(U, (tx) => familyReceipts(tx, aThere))).toEqual([]);
  });
});

describe("the portal", () => {
  it("a parent with two children in one academy sees both, and nothing else", async () => {
    expect((await withTenant(T, (tx) => childrenOf(tx, a))).map((c) => c.fullName)).toEqual(["Aarav Deshmukh", "Anaya Deshmukh"]);
    expect((await withTenant(T, (tx) => childrenOf(tx, b))).map((c) => c.fullName)).toEqual(["Zoya Shaikh"]);
    expect((await withTenant(T, (tx) => familyReceipts(tx, a))).map((r) => r.id)).toEqual([receipt.a]);
    expect((await withTenant(T, (tx) => portalReceipt(tx, a, receipt.a ?? ""))).payment.amountPaise).toBe(50_000n);
  });

  it("attendance shown to a parent matches exactly what the teacher marked", async () => {
    const marked = await withTenant(T, (tx) =>
      tx.select({ date: sessions.sessionDate, mark: attendance.status }).from(attendance).innerJoin(sessions, eq(sessions.id, attendance.sessionId)).where(eq(attendance.studentId, kid.aarav ?? "")),
    );
    for (const month of new Set(marked.map((m) => m.date.slice(0, 7)))) {
      const page = await withTenant(T, (tx) => childPage(tx, a, kid.aarav ?? "", { month }));
      const shown = page.attendance.days.filter((d) => d.mark).map((d) => [d.date, d.mark]);
      expect(shown).toEqual(marked.filter((m) => m.date.startsWith(month)).map((m) => [m.date, m.mark]).sort());
    }
  });

  it("fees: what is unpaid on this child's invoices, nothing on a sibling without one", async () => {
    const aarav = await withTenant(T, (tx) => childPage(tx, a, kid.aarav ?? ""));
    expect(aarav.fees.map((f) => [f.duePaise, f.overdue])).toEqual([[80_000n, false]]);
    expect((await withTenant(T, (tx) => childPage(tx, a, kid.anaya ?? ""))).fees).toEqual([]);
    expect(aarav.timings.map((t) => t.batchName)).toEqual(["Early"]);
  });

  it("pay online opens the private page of this family's unpaid invoice, on its own academy only", async () => {
    const [due] = (await withTenant(T, (tx) => childPage(tx, a, kid.aarav ?? ""))).fees;
    const link = await withTenant(T, (tx) => payLink(tx, a, due?.id ?? ""));
    const token = link.replace("/i/", "");
    expect((await sharedInvoice(token, `portal-${stamp}`))?.invoice.id).toBe(due?.id);
    expect(await sharedInvoice(token, `other-${stamp}`)).toBeUndefined();
    await expect(withTenant(T, (tx) => payLink(tx, b, due?.id ?? ""))).rejects.toMatchObject({ status: 404 });
  });
});
