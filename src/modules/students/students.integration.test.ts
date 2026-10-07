import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/dates";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enroll, leaveEnrollment } from "@/modules/enrollments/service";
import { listRoles } from "@/modules/staff/repo";
import type { StaffUser } from "@/modules/staff/schema";
import { createStaffMember, loadAccessContext, setStaffBranches } from "@/modules/staff/service";
import { countByStatus, countStudents, countWithoutBatch, guardiansOfHousehold, searchStudents, studentsOfHousehold } from "@/modules/students/repo";
import { guardians, students } from "@/modules/students/schema";
import {
  archiveStudent,
  createStudent,
  DuplicateGuardianError,
  lookupGuardian,
  requireStudent,
  setStudentCode,
  setStudentStatus,
  type StudentCtx,
  studentOverview,
} from "@/modules/students/service";
import { createBranch } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let owner: StaffUser;
let mainBranch = "";
let otherBranch = "";
let ownerCtx: StudentCtx;
const P = (n: number) => `+919${String(100_000_000 + n).padStart(9, "0")}`;
const consents = { dataProcessing: true };

const ctxFor = async (staffId: string, tenantId = T): Promise<StudentCtx> => {
  const base = await withTenant(tenantId, (tx) => loadAccessContext(tx, staffId));
  const branchIds = await withTenant(tenantId, async (tx) => (await import("@/modules/staff/repo")).staffBranchIds(tx, staffId));
  return { ...base, branchIds };
};

beforeAll(async () => {
  const created = await testAcademy({ name: `Student Test ${stamp}`, slug: `stu-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `owner-${stamp}@example.test` } });
  T = created.tenant.id;
  owner = created.owner;
  mainBranch = created.branch.id;
  expect(created.tenant.codePrefix).toMatch(/^[A-Z]{2,5}$/);
  otherBranch = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Other" }))).id;
  ownerCtx = await ctxFor(owner.id);
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("families", () => {
  it("creates household, guardian, student, link and consent for a minor with a new guardian", async () => {
    const r = await withTenant(T, (tx) =>
      createStudent(tx, ownerCtx, { fullName: "Aarav Deshmukh", dateOfBirth: "2015-03-12", guardian: { fullName: "Rakesh Deshmukh", phone: "98765 00001", relation: "father" }, consents: { dataProcessing: true, photo: true } }),
    );
    expect(r.household.name).toBe("Deshmukh family");
    expect(r.guardian.phone).toBe("+919876500001");
    expect(r.student.code).toMatch(/^[A-Z]{2,5}\/\d{4}\/0001$/);
    expect(r.student.branchId).toBe(mainBranch);
    const o = await withTenant(T, (tx) => studentOverview(tx, ownerCtx, r.student.id));
    expect(o.guardians.map((g) => [g.fullName, g.relation])).toEqual([["Rakesh Deshmukh", "father"]]);
    expect(o.consents).toEqual({ data_processing: true, photo: true });
  });

  it("a second child with the same phone and no householdId gets a 409 with the family to link to", async () => {
    const attempt = withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Anaya Deshmukh", dateOfBirth: "2018-07-01", guardian: { fullName: "Rakesh Deshmukh", phone: "+91 98765 00001", relation: "father" }, consents }));
    await expect(attempt).rejects.toBeInstanceOf(DuplicateGuardianError);
    await expect(attempt).rejects.toMatchObject({ status: 409, suggestion: { householdName: "Deshmukh family", guardianName: "Rakesh Deshmukh", students: ["Aarav Deshmukh"] } });
    expect(await withTenant(T, (tx) => lookupGuardian(tx, "+919876500001"))).toMatchObject({ guardianName: "Rakesh Deshmukh" });
  });

  it("linking to the household reuses the guardian row: no duplicate guardian", async () => {
    const s = await withTenant(T, (tx) => lookupGuardian(tx, "+919876500001"));
    const r = await withTenant(T, (tx) =>
      createStudent(tx, ownerCtx, { fullName: "Anaya Deshmukh", dateOfBirth: "2018-07-01", householdId: s?.householdId ?? "", guardian: { fullName: "Rakesh Deshmukh", phone: "9876500001", relation: "father" }, consents }),
    );
    const [gs, kids] = await withTenant(T, async (tx) => [await guardiansOfHousehold(tx, r.household.id), await studentsOfHousehold(tx, r.household.id)]);
    expect(gs).toHaveLength(1);
    expect(kids.map((k) => k.fullName).sort()).toEqual(["Aarav Deshmukh", "Anaya Deshmukh"]);
    const o = await withTenant(T, (tx) => studentOverview(tx, ownerCtx, r.student.id));
    expect(o.siblings.map((x) => x.fullName)).toEqual(["Aarav Deshmukh"]);
    const [dup] = await platformDb.select({ n: guardians.id }).from(guardians).where(eq(guardians.phone, "+919876500001"));
    expect(dup).toBeDefined();
  });

  it("an adult can be their own guardian", async () => {
    const r = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Meher Kaur", dateOfBirth: "1998-01-01", adultPhone: "98765 00002", consents }));
    expect(r.household.name).toBe("Meher Kaur");
    const o = await withTenant(T, (tx) => studentOverview(tx, ownerCtx, r.student.id));
    expect(o.guardians[0]).toMatchObject({ fullName: "Meher Kaur", relation: "self", phone: "+919876500002" });
  });
});

describe("rules", () => {
  it("refuses a minor without consent or without a guardian, and treats a missing date of birth as a minor", async () => {
    const g = { fullName: "Geeta Rao", phone: P(10), relation: "mother" as const };
    await expect(withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "No Consent", dateOfBirth: "2016-01-01", guardian: g, consents: { dataProcessing: false } }))).rejects.toThrow(/consent is required/);
    await expect(withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "No Guardian", dateOfBirth: "2016-01-01", adultPhone: P(11), consents }))).rejects.toThrow(/needs a parent or guardian/);
    await expect(withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "No DOB", adultPhone: P(12), consents }))).rejects.toThrow(/needs a parent or guardian/);
  });

  it("refuses a bad phone with a plain message", async () => {
    await expect(withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Bad Phone", dateOfBirth: "2016-01-01", guardian: { fullName: "Geeta Rao", phone: "12345", relation: "father" }, consents }))).rejects.toThrow(/10-digit/);
  });

  it("allocates 20 distinct sequential codes under concurrency", async () => {
    const before = await withTenant(T, (tx) => countStudents(tx, { branchIds: [] }));
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: `Bulk ${i}`, dateOfBirth: "2014-01-01", guardian: { fullName: `Parent ${i}`, phone: P(100 + i), relation: "father" }, consents }))),
    );
    const numbers = results.map((r) => Number(r.student.code.split("/")[2])).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(20);
    expect(numbers[19]! - numbers[0]!).toBe(19); // contiguous
    expect(await withTenant(T, (tx) => countStudents(tx, { branchIds: [] }))).toBe(before + 20);
  });

  it("status transitions follow the fixed list and are audited", async () => {
    const r = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Status Kid", dateOfBirth: "2014-01-01", guardian: { fullName: "Prakash Rao", phone: P(200), relation: "father" }, consents }));
    const id = r.student.id;
    const set = (input: Parameters<typeof setStudentStatus>[3]) => withTenant(T, (tx) => setStudentStatus(tx, ownerCtx, id, input));
    expect((await set({ status: "paused" })).status).toBe("paused");
    await expect(set({ status: "prospect" })).rejects.toThrow(/Can't go from paused to prospect/);
    await expect(set({ status: "left" })).rejects.toThrow(/Pick a reason/);
    await expect(set({ status: "left", reason: "other" })).rejects.toThrow(/short note/);
    const left = await set({ status: "left", reason: "timing" });
    expect(left).toMatchObject({ status: "left", leftReason: "timing" });
    expect(left.leftOn).not.toBeNull();
    await expect(set({ status: "paused" })).rejects.toThrow(/Can't go from left to paused/);
    const back = await set({ status: "active" });
    expect(back).toMatchObject({ status: "active", leftOn: null, leftReason: null });
    const audit = await withTenant(T, (tx) => tx.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, id)));
    expect(audit.filter((a) => a.action === "student.status.set")).toHaveLength(3);
  });

  it("the code can be changed once, must be unique, then locks", async () => {
    const a = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Code A", dateOfBirth: "2014-01-01", guardian: { fullName: "Prakash Rao", phone: P(300), relation: "father" }, consents }));
    const b = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Code B", dateOfBirth: "2014-01-01", guardian: { fullName: "Prakash Rao", phone: P(301), relation: "father" }, consents }));
    await expect(withTenant(T, (tx) => setStudentCode(tx, ownerCtx, a.student.id, b.student.code))).rejects.toThrow(/already used/);
    await expect(withTenant(T, (tx) => setStudentCode(tx, ownerCtx, a.student.id, "bad code"))).rejects.toThrow(/must look like/);
    const changed = await withTenant(T, (tx) => setStudentCode(tx, ownerCtx, a.student.id, "old/2019/0042"));
    expect(changed.code).toBe("OLD/2019/0042");
    await expect(withTenant(T, (tx) => setStudentCode(tx, ownerCtx, a.student.id, "OLD/2019/0043"))).rejects.toThrow(/locked/);
  });

  it("search finds by partial name and by partial phone, case-insensitively", async () => {
    const find = (q: string) => withTenant(T, (tx) => searchStudents(tx, { branchIds: [] }, { q }));
    expect((await find("aarav")).map((r) => r.student.fullName)).toEqual(["Aarav Deshmukh"]);
    expect((await find("DESHMUKH")).map((r) => r.student.fullName).sort()).toEqual(["Aarav Deshmukh", "Anaya Deshmukh"]);
    expect((await find("8765 0000")).map((r) => r.student.fullName).sort()).toEqual(["Aarav Deshmukh", "Anaya Deshmukh", "Meher Kaur"]);
    expect((await find("zzzz"))).toEqual([]);
    expect((await withTenant(T, (tx) => searchStudents(tx, { branchIds: [] }, { status: "paused" }))).length).toBe(0);
  });

  it("the list pages by 50 with a matching count, and counts by status", async () => {
    const all = { branchIds: [] };
    const [first, second, matched, byStatus] = await withTenant(T, async (tx) => [
      await searchStudents(tx, all, { q: "deshmukh", limit: 1 }),
      await searchStudents(tx, all, { q: "deshmukh", limit: 1, offset: 1 }),
      await countStudents(tx, all, { q: "8765 0000" }),
      await countByStatus(tx, all),
    ] as const);
    expect([first[0]?.student.fullName, second[0]?.student.fullName]).toEqual(["Aarav Deshmukh", "Anaya Deshmukh"]);
    expect(matched).toBe(3);
    expect(byStatus.active).toBe(await withTenant(T, (tx) => countStudents(tx, all, { status: "active" })));
  });
});

describe("branch scoping", () => {
  it("staff limited to one branch cannot list or open another branch's student", async () => {
    const otherKid = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Other Branch Kid", dateOfBirth: "2014-01-01", branchId: otherBranch, guardian: { fullName: "Prakash Rao", phone: P(400), relation: "father" }, consents }));
    const desk = await withTenant(T, async (tx) => {
      const roles = await listRoles(tx);
      const s = await createStaffMember(tx, ownerCtx, { email: `desk-${stamp}@example.test`, fullName: "Desk", roleId: roles.find((r) => r.name === "Front Desk")?.id ?? "" });
      await setStaffBranches(tx, ownerCtx, s.id, [mainBranch]);
      return s;
    });
    const deskCtx = await ctxFor(desk.id);
    expect(deskCtx.branchIds).toEqual([mainBranch]);
    const names = (await withTenant(T, (tx) => searchStudents(tx, { branchIds: deskCtx.branchIds }, {}))).map((r) => r.student.fullName);
    expect(names).not.toContain("Other Branch Kid");
    expect(names).toContain("Aarav Deshmukh");
    await expect(withTenant(T, (tx) => requireStudent(tx, deskCtx, otherKid.student.id))).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(T, (tx) => createStudent(tx, deskCtx, { fullName: "Sneak", dateOfBirth: "2014-01-01", branchId: otherBranch, guardian: { fullName: "Prakash Rao", phone: P(401), relation: "father" }, consents }))).rejects.toMatchObject({ status: 404 });
  });
});

describe("archive", () => {
  it("soft-deletes a student with no history (enrollments test covers the refusal)", async () => {
    const r = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Temp Kid", dateOfBirth: "2014-01-01", guardian: { fullName: "Prakash Rao", phone: P(500), relation: "father" }, consents }));
    await withTenant(T, (tx) => archiveStudent(tx, ownerCtx, r.student.id));
    await expect(withTenant(T, (tx) => requireStudent(tx, ownerCtx, r.student.id))).rejects.toMatchObject({ status: 404 });
    const [row] = await platformDb.select({ d: students.deletedAt }).from(students).where(eq(students.id, r.student.id));
    expect(row?.d).not.toBeNull();
  });
});

describe("waiting for a batch", () => {
  const waiting = (branchIds: string[]) => withTenant(T, (tx) => countWithoutBatch(tx, { branchIds }));
  const counts = async () => [await waiting([]), await waiting([mainBranch]), await waiting([otherBranch])] as const;
  const child = (fullName: string, phone: number) =>
    withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName, branchId: mainBranch, guardian: { fullName: `Parent of ${fullName}`, phone: P(phone), relation: "mother" }, consents }));

  it("counts active students with no active enrollment, and respects branch scope", async () => {
    const [all, main, other] = await counts();
    await child("Unenrolled Child", 871);
    expect(await counts()).toEqual([all + 1, main + 1, other]); // one more overall and in its branch, none in the other
  });

  it("leaves out students in a batch, paused or archived, and takes back one who has left it", async () => {
    const base = await waiting([mainBranch]);
    const [inBatch, paused, archived] = [await child("Batch Child", 872), await child("Paused Child", 873), await child("Archived Child", 874)];
    expect(await waiting([mainBranch])).toBe(base + 3);

    const program = await withTenant(T, (tx) => addProgram(tx, ownerCtx, { name: "Karate" }));
    const batch = await withTenant(T, (tx) => createBatch(tx, ownerCtx, { name: "Karate A", programId: program.id, slots: [{ weekday: 1, startTime: "17:00", endTime: "18:00" }] }));
    const joined = await withTenant(T, (tx) => enroll(tx, ownerCtx, { studentId: inBatch.student.id, batchId: batch.id }));
    await withTenant(T, (tx) => setStudentStatus(tx, ownerCtx, paused.student.id, { status: "paused" }));
    await withTenant(T, (tx) => archiveStudent(tx, ownerCtx, archived.student.id));
    expect(await waiting([mainBranch])).toBe(base);

    await withTenant(T, (tx) => leaveEnrollment(tx, ownerCtx, joined.id));
    expect(await waiting([mainBranch])).toBe(base + 1);
  });
});

describe("join date", () => {
  it("defaults to the academy's local day, not the UTC day", async () => {
    // Of UTC+14 and UTC-12, one is always on a different calendar day than UTC.
    const timezone = todayIn("Pacific/Kiritimati") !== todayIn("UTC") ? "Pacific/Kiritimati" : "Etc/GMT+12";
    expect(todayIn(timezone)).not.toBe(todayIn("UTC"));
    const t = await testAcademy({ name: `Tz Test ${stamp}`, slug: `tz-${stamp}`, timezone, owner: { name: "Owner", email: `tz-owner-${stamp}@example.test` } });
    try {
      const ctx = await ctxFor(t.owner.id, t.tenant.id);
      const r = await withTenant(t.tenant.id, (tx) => createStudent(tx, ctx, { fullName: "Zoya Khan", dateOfBirth: "1998-01-01", adultPhone: "98765 00077", consents }));
      expect(r.student.joinedOn).toBe(todayIn(timezone));
    } finally {
      await deleteTenantsCompletely([t.tenant.id]);
    }
  });
});

// Reads household_id and app.households: rewrite or delete when migration 0040 drops them.
describe("payer backfill (migration 0039)", () => {
  it("gives each invoice, payment and enrollment the right payer", async () => {
    const own = postgres(getEnv().DATABASE_URL_MIGRATOR ?? "", { max: 1, onnotice: () => {} });
    try {
      const a = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Imran Sheikh", dateOfBirth: "2014-01-01", guardian: { fullName: "Rafiq Sheikh", phone: P(901), relation: "father" }, consents }));
      const b = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Zara Sheikh", dateOfBirth: "2016-01-01", householdId: a.household.id, guardian: { fullName: "Sana Sheikh", phone: P(902), relation: "mother" }, consents }));
      const c = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Omar Pathan", dateOfBirth: "2014-01-01", guardian: { fullName: "Latif Pathan", phone: P(903), relation: "father" }, consents }));
      const program = await withTenant(T, (tx) => addProgram(tx, ownerCtx, { name: "Backfill" }));
      const batch = await withTenant(T, (tx) => createBatch(tx, ownerCtx, { name: "Backfill A", programId: program.id, slots: [{ weekday: 2, startTime: "17:00", endTime: "18:00" }] }));
      const enrollIn = (studentId: string) => withTenant(T, (tx) => enroll(tx, ownerCtx, { studentId, batchId: batch.id }));
      const ea = await enrollIn(a.student.id);
      const eb = await enrollIn(b.student.id);
      const ec = await enrollIn(c.student.id);
      const today = todayIn("Asia/Kolkata");
      // Household 1: Rafiq is primary, Sana manages Zara. Household 2: its only guardian is soft-deleted.
      await own`UPDATE app.guardians SET is_primary = (id = ${a.guardian.id}) WHERE household_id = ${a.household.id}`;
      // Sana is the older record, so only is_primary can make Rafiq the payer.
      await own`UPDATE app.guardians SET created_at = created_at - interval '1 day' WHERE id = ${b.guardian.id}`;
      await own`UPDATE app.student_guardians SET is_manager = true WHERE student_id = ${b.student.id} AND guardian_id = ${b.guardian.id}`;
      await own`UPDATE app.guardians SET deleted_at = now() WHERE id = ${c.guardian.id}`;
      const money = async (household: string, n: number) => {
        const [inv] = await own`INSERT INTO app.invoices (tenant_id, branch_id, household_id, number, fy, issue_date, due_date, subtotal_paise, total_paise, status, issued_at)
          VALUES (${T}, ${mainBranch}, ${household}, ${`BF/${stamp}/${n}`}, '2026-27', ${today}, ${today}, 10000, 10000, 'issued', now()) RETURNING id`;
        const [pay] = await own`INSERT INTO app.payments (tenant_id, branch_id, household_id, receipt_number, fy, method, amount_paise, received_on, recorded_on)
          VALUES (${T}, ${mainBranch}, ${household}, ${`BF-R/${stamp}/${n}`}, '2026-27', 'cash', 5000, ${today}, ${today}) RETURNING id`;
        return { inv: inv?.id as string, pay: pay?.id as string };
      };
      // Household 3: a soft-deleted primary, older, beside a live guardian: the live one must win.
      const d = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Dua Ansari", dateOfBirth: "2014-01-01", guardian: { fullName: "Live Ansari", phone: P(904), relation: "mother" }, consents }));
      const dOld = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Dawood Ansari", dateOfBirth: "2015-01-01", householdId: d.household.id, guardian: { fullName: "Gone Ansari", phone: P(905), relation: "father" }, consents }));
      await own`UPDATE app.guardians SET is_primary = (id = ${dOld.guardian.id}), created_at = CASE WHEN id = ${dOld.guardian.id} THEN created_at - interval '1 day' ELSE created_at END,
        deleted_at = CASE WHEN id = ${dOld.guardian.id} THEN now() END WHERE household_id = ${d.household.id}`;
      // Households 4 and 5: two live guardians with the same flags and created_at; the lower id wins.
      // Rewrite them in opposite orders so neither storage order lets a missing id tiebreak pass.
      const tied = async (n: number, lowerLast: boolean) => {
        const x = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: `Tie${n} One`, dateOfBirth: "2014-01-01", guardian: { fullName: `Tie${n} One`, phone: P(910 + n * 2), relation: "mother" }, consents }));
        const y = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: `Tie${n} Two`, dateOfBirth: "2015-01-01", householdId: x.household.id, guardian: { fullName: `Tie${n} Two`, phone: P(911 + n * 2), relation: "father" }, consents }));
        const [lower = "", higher = ""] = [x.guardian.id, y.guardian.id].sort();
        for (const id of lowerLast ? [higher, lower] : [lower, higher]) await own`UPDATE app.guardians SET is_primary = false, created_at = '2026-01-01T00:00:00Z' WHERE id = ${id}`;
        return { household: x.household.id, lower };
      };
      const t4 = await tied(4, true);
      const t5 = await tied(5, false);
      const m1 = await money(a.household.id, 1);
      const m3 = await money(d.household.id, 3);
      const m4 = await money(t4.household, 4);
      const m5 = await money(t5.household, 5);
      const m2 = await money(c.household.id, 2);

      const migration = readFileSync(join(process.cwd(), "migrations/0039_member_guardian_payer.sql"), "utf8");
      await own.unsafe(migration.slice(migration.indexOf("-- Backfill:"), migration.indexOf("-- A household with no guardian")));

      const payerOf = async (table: "invoices" | "payments" | "enrollments", id: string) =>
        (await own.unsafe(`SELECT payer_guardian_id, payer_member_id FROM app.${table} WHERE id = $1`, [id]))[0];
      expect((await payerOf("invoices", m1.inv))).toEqual({ payer_guardian_id: a.guardian.id, payer_member_id: null });
      expect((await payerOf("payments", m1.pay))).toEqual({ payer_guardian_id: a.guardian.id, payer_member_id: null });
      expect((await payerOf("invoices", m2.inv))?.payer_guardian_id).toBe(c.guardian.id);
      expect((await payerOf("payments", m2.pay))?.payer_guardian_id).toBe(c.guardian.id);
      expect((await payerOf("invoices", m3.inv))?.payer_guardian_id).toBe(d.guardian.id);
      expect((await payerOf("payments", m3.pay))?.payer_guardian_id).toBe(d.guardian.id);
      expect((await payerOf("invoices", m4.inv))?.payer_guardian_id).toBe(t4.lower);
      expect((await payerOf("payments", m4.pay))?.payer_guardian_id).toBe(t4.lower);
      expect((await payerOf("invoices", m5.inv))?.payer_guardian_id).toBe(t5.lower);
      expect((await payerOf("payments", m5.pay))?.payer_guardian_id).toBe(t5.lower);
      expect((await payerOf("enrollments", ea.id))?.payer_guardian_id).toBe(a.guardian.id);
      expect((await payerOf("enrollments", eb.id))?.payer_guardian_id).toBe(b.guardian.id);
      expect((await payerOf("enrollments", ec.id))?.payer_guardian_id).toBe(c.guardian.id);
      const names = await own`SELECT id, bill_to_name FROM app.invoices WHERE id IN ${own([m1.inv, m2.inv])}`;
      expect(Object.fromEntries(names.map((r) => [r.id, r.bill_to_name]))).toEqual({ [m1.inv]: "Rafiq Sheikh", [m2.inv]: "Latif Pathan" });
    } finally {
      await own.end({ timeout: 5 });
    }
  });
});
