import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { listRoles } from "@/modules/staff/repo";
import type { StaffUser } from "@/modules/staff/schema";
import { createStaffMember, loadAccessContext, setStaffBranches } from "@/modules/staff/service";
import { countByStatus, countStudents, guardiansOfHousehold, searchStudents, studentsOfHousehold } from "@/modules/students/repo";
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

const ctxFor = async (staffId: string): Promise<StudentCtx> => {
  const base = await withTenant(T, (tx) => loadAccessContext(tx, staffId));
  const branchIds = await withTenant(T, async (tx) => (await import("@/modules/staff/repo")).staffBranchIds(tx, staffId));
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
