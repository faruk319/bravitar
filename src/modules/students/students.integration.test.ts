import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/dates";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addProgram, createBatch } from "@/modules/batches/service";
import { insertInvoice } from "@/modules/fees/repo";
import { attendance } from "@/modules/attendance/schema";
import { sessions } from "@/modules/sessions/schema";
import { enroll, leaveEnrollment } from "@/modules/enrollments/service";
import { listRoles } from "@/modules/staff/repo";
import type { StaffUser } from "@/modules/staff/schema";
import { createStaffMember, loadAccessContext, setStaffBranches } from "@/modules/staff/service";
import {
  countByStatus,
  countStudents, countWithoutBatch,
  createGuardian,
  guardiansOfMembers,
  guardiansOfStudent,
  moveManager,
  removeFamilyLink,
  searchStudents,
  siblingsOf,
  studentsOfGuardian,
  updateGuardian,
  updateStudent,
  upsertFamilyLink,
} from "@/modules/students/repo";
import { addFamilyMember } from "@/modules/students/family";
import { uuidv7 } from "@/lib/ids";
import { guardians, students } from "@/modules/students/schema";
import {
  archiveStudent,
  createStudent,
  KnownGuardianError,
  lookupKnownGuardian,
  requireStudent,
  setStudentCode,
  setStudentStatus,
  type StudentCtx,
  studentCounts,
  studentList,
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
// New fixtures call freshPhone(): the hand-picked P(n) ranges above stay below 10_000.
let phoneSeq = 0;
const freshPhone = () => P(1_000_000 + ++phoneSeq);
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
  it("creates guardian, student, link and consent for a minor with a new guardian", async () => {
    const r = await withTenant(T, (tx) =>
      createStudent(tx, ownerCtx, { fullName: "Aarav Deshmukh", dateOfBirth: "2015-03-12", guardian: { fullName: "Rakesh Deshmukh", phone: "98765 00001", relation: "father" }, consents: { dataProcessing: true, photo: true } }),
    );
    expect(r.guardian.phone).toBe("+919876500001");
    expect(r.student.code).toMatch(/^[A-Z]{2,5}\/\d{4}\/0001$/);
    expect(r.student.branchId).toBe(mainBranch);
    const o = await withTenant(T, (tx) => studentOverview(tx, ownerCtx, r.student.id));
    expect(o.guardians.map((g) => [g.fullName, g.relation])).toEqual([["Rakesh Deshmukh", "father"]]);
    expect(o.consents).toEqual({ data_processing: true, photo: true });
  });

  it("a second child with a known phone gets a 409 saying who it is, and nothing is created", async () => {
    const attempt = () => withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Anaya Deshmukh", dateOfBirth: "2018-07-01", guardian: { fullName: "Rakesh Deshmukh", phone: "+91 98765 00001", relation: "father" }, consents }));
    const err = await attempt().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KnownGuardianError);
    expect(err).toMatchObject({ status: 409, known: { fullName: "Rakesh Deshmukh", linked: false, hidden: 0, members: [{ fullName: "Aarav Deshmukh", relation: "father" }] } });
    expect(await withTenant(T, (tx) => lookupKnownGuardian(tx, ownerCtx, "+919876500001"))).toMatchObject({ fullName: "Rakesh Deshmukh" });
    expect(await withTenant(T, (tx) => tx.select().from(students).where(eq(students.fullName, "Anaya Deshmukh")))).toHaveLength(0);
  });

  it("linking the guardian reuses the row: no duplicate guardian, and the children are siblings", async () => {
    const s = await withTenant(T, (tx) => lookupKnownGuardian(tx, ownerCtx, "+919876500001"));
    const r = await withTenant(T, (tx) =>
      createStudent(tx, ownerCtx, { fullName: "Anaya Deshmukh", dateOfBirth: "2018-07-01", linkGuardianId: s?.guardianId ?? "", guardian: { fullName: "Rakesh Deshmukh", phone: "9876500001", relation: "father" }, consents }),
    );
    expect(r.guardian.id).toBe(s?.guardianId);
    const [gs, kids] = await withTenant(T, async (tx) => [await guardiansOfStudent(tx, r.student.id), await studentsOfGuardian(tx, r.guardian.id)]);
    expect(gs).toHaveLength(1);
    expect(kids.map((k) => k.fullName).sort()).toEqual(["Aarav Deshmukh", "Anaya Deshmukh"]);
    const o = await withTenant(T, (tx) => studentOverview(tx, ownerCtx, r.student.id));
    expect(o.siblings.map((x) => x.fullName)).toEqual(["Aarav Deshmukh"]);
    const [dup] = await platformDb.select({ n: guardians.id }).from(guardians).where(eq(guardians.phone, "+919876500001"));
    expect(dup).toBeDefined();
  });

  it("an adult can be their own guardian", async () => {
    const r = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Meher Kaur", dateOfBirth: "1998-01-01", adultPhone: "98765 00002", consents }));
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

describe("student_guardians is the only family link", () => {
  const mk = (name: string, guardian: string, phone: string) =>
    withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: name, dateOfBirth: "2015-03-12", guardian: { fullName: guardian, phone, relation: "mother" }, consents }));

  it("one guardian links to two members who had different guardians", async () => {
    const a = await mk("Zoya Link", "Nadia Link", P(201));
    const b = await mk("Yusuf Link", "Omar Link", P(202));
    expect(a.guardian.id).not.toBe(b.guardian.id);
    await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: a.guardian.id, relation: "mother" }));
    const [kids, ofA, ofB] = await withTenant(T, async (tx) => [await studentsOfGuardian(tx, a.guardian.id), await guardiansOfStudent(tx, a.student.id), await guardiansOfStudent(tx, b.student.id)]);
    expect(kids.map((k) => k.fullName)).toEqual(["Yusuf Link", "Zoya Link"]);
    expect(ofA.map((g) => g.id)).toEqual([a.guardian.id]);
    expect(ofB.map((g) => [g.fullName, g.isManager])).toEqual([["Omar Link", true], ["Nadia Link", false]]);
    // Both members at once: each guardian once (Nadia is linked to both).
    const both = await withTenant(T, (tx) => guardiansOfMembers(tx, [a.student.id, b.student.id]));
    expect(both.map((g) => g.fullName)).toEqual(["Nadia Link", "Omar Link"]);
    expect(both.find((g) => g.id === a.guardian.id)?.isManager).toBe(true);
  });

  it("one member with two guardians lists the manager first, whoever was added first", async () => {
    const a = await mk("Mina Pair", "Parveen Pair", P(203));
    const second = await withTenant(T, async (tx) => {
      const g = await createGuardian(tx, { tenantId: T, fullName: "Aamir Pair", phone: P(204) });
      await upsertFamilyLink(tx, { tenantId: T, studentId: a.student.id, guardianId: g.id, relation: "father" });
      return g;
    });
    expect((await withTenant(T, (tx) => guardiansOfStudent(tx, a.student.id))).map((g) => [g.fullName, g.isManager])).toEqual([["Parveen Pair", true], ["Aamir Pair", false]]);
    await withTenant(T, (tx) => moveManager(tx, a.student.id, second.id));
    expect((await withTenant(T, (tx) => guardiansOfStudent(tx, a.student.id))).map((g) => [g.fullName, g.relation, g.isManager])).toEqual([["Aamir Pair", "father", true], ["Parveen Pair", "mother", false]]);
  });

  it("a removed link is gone in both directions, and comes back when restored", async () => {
    const a = await mk("Rida Gone", "Salma Gone", P(205));
    const b = await mk("Raza Gone", "Tariq Gone", P(206));
    await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: a.guardian.id, relation: "mother" }));
    await withTenant(T, (tx) => removeFamilyLink(tx, b.student.id, a.guardian.id, new Date()));
    const [kids, ofB] = await withTenant(T, async (tx) => [await studentsOfGuardian(tx, a.guardian.id), await guardiansOfStudent(tx, b.student.id)]);
    expect(kids.map((k) => k.fullName)).toEqual(["Rida Gone"]);
    expect(ofB.map((g) => g.fullName)).toEqual(["Tariq Gone"]);
    await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: a.guardian.id, relation: "mother" }));
    expect((await withTenant(T, (tx) => studentsOfGuardian(tx, a.guardian.id))).map((k) => k.fullName)).toEqual(["Raza Gone", "Rida Gone"]);
  });

  it("a soft-deleted guardian is not listed, and a deleted member is not theirs", async () => {
    const a = await mk("Sana Del", "Tabassum Del", P(207));
    const g2 = await withTenant(T, async (tx) => {
      const g = await createGuardian(tx, { tenantId: T, fullName: "Umar Del", phone: P(208) });
      await upsertFamilyLink(tx, { tenantId: T, studentId: a.student.id, guardianId: g.id, relation: "father" });
      return g;
    });
    await withTenant(T, (tx) => updateGuardian(tx, g2.id, { deletedAt: new Date() }));
    expect((await withTenant(T, (tx) => guardiansOfStudent(tx, a.student.id))).map((g) => g.fullName)).toEqual(["Tabassum Del"]);
    await withTenant(T, (tx) => updateGuardian(tx, a.guardian.id, { deletedAt: new Date() }));
    expect(await withTenant(T, (tx) => guardiansOfStudent(tx, a.student.id))).toEqual([]);
  });

  it("addFamilyMember asks the join table: a guardian linked to another member is asked about", async () => {
    const a = await mk("Dina Row", "Esha Row", P(211));
    const b = await mk("Dev Row", "Farid Row", P(212));
    const b2 = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Dua Row", dateOfBirth: "2016-03-12", linkGuardianId: b.guardian.id, guardian: { fullName: "Farid Row", phone: P(212), relation: "father" }, consents }));
    // Esha is Dina's guardian, and linked to Dev too.
    await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: a.guardian.id, relation: "cousin" }));
    const add = (linkGuardianId?: string) => withTenant(T, (tx) => addFamilyMember(tx, ownerCtx, b2.student.id, { fullName: "Esha Row", phone: P(211), relation: "cousin", ...(linkGuardianId ? { linkGuardianId } : {}) }));
    const err = await add().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KnownGuardianError);
    expect((err as KnownGuardianError).known.members.map((m) => m.fullName).sort()).toEqual(["Dev Row", "Dina Row"]);
    expect((await add(a.guardian.id)).id).toBe(a.guardian.id);
    expect((await withTenant(T, (tx) => guardiansOfStudent(tx, b2.student.id))).map((g) => g.fullName).sort()).toEqual(["Esha Row", "Farid Row"]);
  });

  it("a guardian in two families is asked about, not refused, and then sees both members", async () => {
    const a = await mk("Gita Decoy", "Hira Decoy", P(213));
    const b = await mk("Gus Decoy", "Imran Decoy", P(214));
    const add = (linkGuardianId?: string) => withTenant(T, (tx) => addFamilyMember(tx, ownerCtx, b.student.id, { fullName: "Hira Decoy", phone: P(213), relation: "cousin", ...(linkGuardianId ? { linkGuardianId } : {}) }));
    const err = await add().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KnownGuardianError);
    expect((err as KnownGuardianError).known).toMatchObject({ guardianId: a.guardian.id, linked: false, members: [{ studentId: a.student.id, fullName: "Gita Decoy", relation: "mother" }] });
    await add(a.guardian.id);
    expect((await withTenant(T, (tx) => studentsOfGuardian(tx, a.guardian.id))).map((k) => k.fullName)).toEqual(["Gita Decoy", "Gus Decoy"]);
  });

  it("createStudent asks about a known number, and links on the answer", async () => {
    const a = await mk("Kiran Ask", "Laxmi Ask", P(215));
    const make = (linkGuardianId?: string) =>
      withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Kavya Ask", dateOfBirth: "2017-03-12", guardian: { fullName: "Laxmi Ask", phone: P(215), relation: "other" }, consents, ...(linkGuardianId ? { linkGuardianId } : {}) }));
    await expect(make()).rejects.toBeInstanceOf(KnownGuardianError);
    await expect(make(uuidv7())).rejects.toBeInstanceOf(KnownGuardianError);
    const made = await make(a.guardian.id);
    expect(made.guardian.id).toBe(a.guardian.id);
    expect((await withTenant(T, (tx) => studentsOfGuardian(tx, a.guardian.id))).map((k) => k.fullName)).toEqual(["Kavya Ask", "Kiran Ask"]);
  });

  it("linkGuardianId is ignored when the phone matches no guardian: a new guardian is made, the named one is not touched", async () => {
    const a = await mk("Zoya Raw", "Nadia Raw", P(219));
    const made = await withTenant(T, (tx) =>
      createStudent(tx, ownerCtx, { fullName: "Yusuf Raw", dateOfBirth: "2017-03-12", guardian: { fullName: "Other Raw", phone: P(220), relation: "father" }, linkGuardianId: a.guardian.id, consents }),
    );
    expect(made.guardian.id).not.toBe(a.guardian.id);
    expect(made.guardian.fullName).toBe("Other Raw");
    expect((await withTenant(T, (tx) => studentsOfGuardian(tx, a.guardian.id))).map((k) => k.fullName)).toEqual(["Zoya Raw"]);
    expect((await withTenant(T, (tx) => studentsOfGuardian(tx, made.guardian.id))).map((k) => k.fullName)).toEqual(["Yusuf Raw"]);
  });

  it("createStudent shows a restricted staff member only the members they may see, and never links a guardian they cannot see", async () => {
    const far = await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Far Kid", branchId: otherBranch, guardian: { fullName: "Far Parent", phone: P(217), relation: "father" }, consents }));
    await withTenant(T, (tx) => createStudent(tx, ownerCtx, { fullName: "Near Kid", branchId: mainBranch, guardian: { fullName: "Far Parent", phone: P(217), relation: "father" }, linkGuardianId: far.guardian.id, consents }));
    const make = (ctx: StudentCtx, branchId: string, linkGuardianId?: string) =>
      withTenant(T, (tx) => createStudent(tx, ctx, { fullName: "New Kid", branchId, guardian: { fullName: "Far Parent", phone: P(217), relation: "father" }, consents, ...(linkGuardianId ? { linkGuardianId } : {}) }));
    const mainOnly = { ...ownerCtx, branchIds: [mainBranch] };
    const partly = await make(mainOnly, mainBranch).catch((e: unknown) => e);
    expect((partly as KnownGuardianError).known).toMatchObject({ guardianId: far.guardian.id, hidden: 1, members: [{ fullName: "Near Kid" }] });
    const otherOnly = { ...ownerCtx, branchIds: [otherBranch] };
    await withTenant(T, (tx) => updateStudent(tx, far.student.id, { branchId: mainBranch }));
    const none = await make(otherOnly, otherBranch, far.guardian.id).catch((e: unknown) => e);
    expect((none as KnownGuardianError).known).toMatchObject({ guardianId: "", hidden: 2, members: [] });
    expect(JSON.stringify((none as KnownGuardianError).known)).not.toMatch(/Far Parent|Far Kid|Near Kid/);
    expect((none as KnownGuardianError).message).toBe("This number is used at another branch");
  });

  describe("siblings share a guardian", () => {
    const sibs = async (id: string) => (await withTenant(T, (tx) => siblingsOf(tx, id))).map((k) => k.fullName);

    it("two members sharing a guardian are siblings, both ways", async () => {
      const a = await mk("Aziz Sib", "Bano Sib", P(9301));
      const b = await mk("Basma Sib", "Chand Sib", P(9302));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: a.guardian.id, relation: "mother" }));
      expect(await sibs(a.student.id)).toEqual(["Basma Sib"]);
      expect(await sibs(b.student.id)).toEqual(["Aziz Sib"]);
      expect((await withTenant(T, (tx) => studentOverview(tx, ownerCtx, a.student.id))).siblings.map((k) => k.fullName)).toEqual(["Basma Sib"]);
    });

    it("members whose guardians differ are not siblings", async () => {
      const a = await mk("Dawood Dec", "Eman Dec", P(9303));
      const b = await mk("Eshal Dec", "Fahad Dec", P(9304));
      expect(await sibs(a.student.id)).toEqual([]);
      expect(await sibs(b.student.id)).toEqual([]);
    });

    it("a member with two guardians, each with another child, has all of them as siblings", async () => {
      const a = await mk("Faiz Tri", "Gul Tri", P(9305));
      const g2 = await withTenant(T, (tx) => createGuardian(tx, { tenantId: T, fullName: "Hasan Tri", phone: P(9306) }));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: a.student.id, guardianId: g2.id, relation: "father" }));
      const b = await mk("Gazala Tri", "Ilyas Tri", P(9307));
      const c = await mk("Hiba Tri", "Jamal Tri", P(9308));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: a.guardian.id, relation: "mother" }));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: c.student.id, guardianId: g2.id, relation: "father" }));
      expect(await sibs(a.student.id)).toEqual(["Gazala Tri", "Hiba Tri"]);
      expect(await sibs(b.student.id)).toEqual(["Faiz Tri"]);
      // Sharing both guardians with a sibling lists them once.
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: g2.id, relation: "father" }));
      expect(await sibs(a.student.id)).toEqual(["Gazala Tri", "Hiba Tri"]);
    });

    it("a removed link creates no sibling", async () => {
      const a = await mk("Idris Rem", "Kausar Rem", P(9309));
      const b = await mk("Jaweria Rem", "Latif Rem", P(9310));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: a.guardian.id, relation: "mother" }));
      expect(await sibs(a.student.id)).toEqual(["Jaweria Rem"]);
      await withTenant(T, (tx) => removeFamilyLink(tx, b.student.id, a.guardian.id, new Date()));
      expect(await sibs(a.student.id)).toEqual([]);
      expect(await sibs(b.student.id)).toEqual([]);
    });

    it("a soft-deleted member is not a sibling, and neither is one reached through a deleted guardian", async () => {
      const a = await mk("Kamal Del2", "Laila Del2", P(9311));
      const b = await mk("Lubna Del2", "Mansur Del2", P(9312));
      const c = await mk("Maaz Del2", "Nargis Del2", P(9313));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b.student.id, guardianId: a.guardian.id, relation: "mother" }));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: c.student.id, guardianId: a.guardian.id, relation: "mother" }));
      expect(await sibs(a.student.id)).toEqual(["Lubna Del2", "Maaz Del2"]);
      await withTenant(T, (tx) => updateStudent(tx, b.student.id, { deletedAt: new Date() }));
      expect(await sibs(a.student.id)).toEqual(["Maaz Del2"]);
      await withTenant(T, (tx) => updateGuardian(tx, a.guardian.id, { deletedAt: new Date() }));
      expect(await sibs(a.student.id)).toEqual([]);
    });

    it("freshPhone hands out a number nobody picked by hand, each time a new one", async () => {
      const [x, y] = [freshPhone(), freshPhone()];
      expect(x).not.toBe(y);
      const a = await mk("Fresh One", "Parent One", x);
      const b = await mk("Fresh Two", "Parent Two", y);
      expect(a.guardian.id).not.toBe(b.guardian.id);
    });
  });
});

describe("listing counts", () => {
  const tag = Math.random().toString(36).slice(2, 8);
  let CT = "";
  let cctx: StudentCtx;
  let phones = 0;
  const kid = (name: string, joinedOn: string) =>
    withTenant(CT, (tx) => createStudent(tx, cctx, { fullName: name, dateOfBirth: "2014-01-01", joinedOn, guardian: { fullName: `${name} Parent`, phone: P(2_000_000 + ++phones), relation: "father" }, consents }));

  beforeAll(async () => {
    const a = await testAcademy({ name: `Counts ${tag}`, slug: `cnt-${tag}`, verticalPreset: "karate", owner: { name: "Owner", email: `cnt-${tag}@example.test` } });
    CT = a.tenant.id;
    cctx = await ctxFor(a.owner.id, CT);
    const [a1, a2, p1, l1, gone] = [await kid("Active Early", "2026-10-01"), await kid("Active Old", "2026-08-10"), await kid("Paused One", "2026-10-02"), await kid("Left One", "2026-07-01"), await kid("Deleted One", "2026-10-03")];
    await withTenant(CT, async (tx) => {
      await updateStudent(tx, p1.student.id, { status: "paused" });
      await updateStudent(tx, l1.student.id, { status: "left", leftOn: "2026-09-01", leftReason: "other" });
      await updateStudent(tx, gone.student.id, { deletedAt: new Date() });
    });
    expect([a1, a2].length).toBe(2);
  });

  afterAll(async () => {
    await deleteTenantsCompletely([CT]);
  });

  // 2026-10-15 in IST: Paused One (10-02) and Active Early (10-01) joined this month.
  const mid = new Date("2026-10-15T06:00:00Z");

  it("counts students by status, and joins within the tenant's month", async () => {
    const c = await withTenant(CT, (tx) => studentCounts(tx, cctx, { now: mid }));
    expect(c).toEqual({ total: 4, active: 2, joinedThisMonth: 2, paused: 1 });
  });

  it("files a student by the tenant's clock, not UTC's, at the month boundary", async () => {
    // 20:00Z on 30 Sep is 01:30 IST on 1 Oct: October has begun for this academy.
    const c = await withTenant(CT, (tx) => studentCounts(tx, cctx, { now: new Date("2026-09-30T20:00:00Z") }));
    expect(c.joinedThisMonth).toBe(2);
    // 19:00Z on 31 Oct is 00:30 IST on 1 Nov: October is over here, though still October in UTC.
    const early = await withTenant(CT, (tx) => studentCounts(tx, cctx, { now: new Date("2026-10-31T19:00:00Z") }));
    expect(early.joinedThisMonth).toBe(0); // 00:30 IST on 1 Nov: October is over
  });

  it("is a measurement, not a permission: a viewer without students:read is refused, not shown zeros", async () => {
    const desk = { ...cctx, isOwner: false, permissions: [] };
    await expect(withTenant(CT, (tx) => studentCounts(tx, desk, { now: mid }))).rejects.toMatchObject({ status: 403 });
    expect((await withTenant(CT, (tx) => studentCounts(tx, cctx, { now: mid }))).total).toBeGreaterThan(0);
  });
});

describe("the listing", () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const now = new Date("2026-10-15T06:00:00Z");
  let LT = "";
  let lctx: StudentCtx;
  let branch = "";
  const id: Record<string, string> = {};
  let karate = "";
  let karateBatch = "";
  let danceBatch = "";
  let phones = 0;
  const kid = (name: string, joinedOn: string) =>
    withTenant(LT, async (tx) => (await createStudent(tx, lctx, { fullName: name, dateOfBirth: "2014-01-01", joinedOn, guardian: { fullName: `${name} Parent`, phone: P(3_000_000 + ++phones), relation: "father" }, consents })).student.id);
  const mark = (studentId: string, sessionId: string, status: "present" | "absent" | "late") =>
    withTenant(LT, (tx) => tx.insert(attendance).values({ id: uuidv7(), tenantId: LT, sessionId, studentId, status }));
  const invoice = (studentId: string, dueDate: string, status: "issued" | "paid") =>
    withTenant(LT, (tx) => insertInvoice(tx, { tenantId: LT, branchId: branch, studentId, number: `T-${++phones}`, fy: "2026-27", issuedAt: new Date("2026-10-01T05:00:00Z"), issueDate: "2026-10-01", dueDate, subtotalPaise: 50_000n, totalPaise: 50_000n, paidPaise: status === "paid" ? 50_000n : 0n, status }));
  const list = (q: Parameters<typeof studentList>[2], ctx = lctx) => withTenant(LT, (tx) => studentList(tx, ctx, q, { now }));
  const names = (l: Awaited<ReturnType<typeof list>>) => l.rows.map((r) => r.student.fullName).sort();

  beforeAll(async () => {
    const a = await testAcademy({ name: `List ${tag}`, slug: `lst-${tag}`, verticalPreset: "karate", owner: { name: "Coach Owner", email: `lst-${tag}@example.test` } });
    LT = a.tenant.id;
    branch = a.branch.id;
    lctx = await ctxFor(a.owner.id, LT);
    const [kp, dp] = [await withTenant(LT, (tx) => addProgram(tx, lctx, { name: "Karate" })), await withTenant(LT, (tx) => addProgram(tx, lctx, { name: "Dance" }))];
    karate = kp.id;
    const slot = [{ weekday: 1, startTime: "17:00", endTime: "18:00" }];
    karateBatch = (await withTenant(LT, (tx) => createBatch(tx, lctx, { name: "Karate A", programId: kp.id, coachId: a.owner.id, slots: slot }))).id;
    danceBatch = (await withTenant(LT, (tx) => createBatch(tx, lctx, { name: "Dance B", programId: dp.id, slots: slot }))).id;
    for (const [n, joined] of [["Asha", "2026-10-02"], ["Bala", "2026-09-10"], ["Chitra", "2026-08-01"], ["Dev", "2026-10-05"]] as const) id[n] = await kid(n, joined);
    for (const [n, b] of [["Asha", karateBatch], ["Bala", karateBatch], ["Chitra", danceBatch]] as const) await withTenant(LT, (tx) => enroll(tx, lctx, { studentId: id[n] ?? "", batchId: b }));
    // Four classes on the karate batch: Asha attends 3 of 4; Bala was never marked. One class is cancelled and must not count.
    const sess = await withTenant(LT, (tx) =>
      tx.insert(sessions).values(["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((d, i) => ({ id: uuidv7(), tenantId: LT, branchId: branch, batchId: karateBatch, startsAt: new Date(`${d}T11:30:00Z`), endsAt: new Date(`${d}T12:30:00Z`), sessionDate: d, status: i === 4 ? ("cancelled" as const) : ("held" as const), cancelReason: i === 4 ? "holiday" : null }))).returning({ id: sessions.id }),
    );
    const [s0, s1, s2, s3, cancelled] = sess.map((r) => r.id);
    await mark(id.Asha ?? "", s0 ?? "", "present");
    await mark(id.Asha ?? "", s1 ?? "", "late");
    await mark(id.Asha ?? "", s2 ?? "", "present");
    await mark(id.Asha ?? "", s3 ?? "", "absent");
    await mark(id.Asha ?? "", cancelled ?? "", "absent");
    await invoice(id.Asha ?? "", "2026-10-05", "issued"); // past due on the 15th
    await invoice(id.Bala ?? "", "2026-10-05", "paid");
    await invoice(id.Chitra ?? "", "2026-10-25", "issued"); // due, not late
  });

  afterAll(async () => {
    await deleteTenantsCompletely([LT]);
  });

  it("each filter returns the right students and the count matches", async () => {
    const all = await list({ page: 1 });
    expect(names(all)).toEqual(["Asha", "Bala", "Chitra", "Dev"]);
    const cases: [Parameters<typeof list>[0], string[]][] = [
      [{ page: 1, programId: karate }, ["Asha", "Bala"]],
      [{ page: 1, batchId: danceBatch }, ["Chitra"]],
      [{ page: 1, coachId: lctx.staffId }, ["Asha", "Bala"]],
      [{ page: 1, fee: "overdue" }, ["Asha"]],
      [{ page: 1, fee: "due" }, ["Chitra"]],
      [{ page: 1, fee: "paid" }, ["Bala"]],
      [{ page: 1, joinedFrom: "2026-10-01" }, ["Asha", "Dev"]],
      [{ page: 1, joinedFrom: "2026-09-01", joinedTo: "2026-09-30" }, ["Bala"]],
      [{ page: 1, programId: karate, fee: "overdue" }, ["Asha"]],
      [{ page: 1, programId: karate, fee: "due" }, []],
    ];
    for (const [q, want] of cases) {
      const l = await list(q);
      expect(names(l), JSON.stringify(q)).toEqual(want);
      expect(l.matched).toBe(want.length);
    }
  });

  it("a filter that matches no one is a measurement: the same viewer sees four without it", async () => {
    expect((await list({ page: 1 })).matched).toBe(4);
    expect((await list({ page: 1, coachId: uuidv7() })).matched).toBe(0);
  });

  it("reads attendance without dividing by zero: no marks is null, a real 0 stays 0, cancelled classes are ignored", async () => {
    const by = Object.fromEntries((await list({ page: 1 })).rows.map((r) => [r.student.fullName, r.attendance?.pct]));
    expect(by).toEqual({ Asha: 75, Bala: null, Chitra: null, Dev: null });
  });

  it("shows batch, program and coach per student, and nothing for one with no batch", async () => {
    const by = Object.fromEntries((await list({ page: 1 })).rows.map((r) => [r.student.fullName, r.placements?.map((p) => [p.batchName, p.programName, p.coachName])]));
    expect(by).toEqual({ Asha: [["Karate A", "Karate", "Coach Owner"]], Bala: [["Karate A", "Karate", "Coach Owner"]], Chitra: [["Dance B", "Dance", null]], Dev: [] });
  });

  it("derives the fee status from invoices: none billed is null, not paid", async () => {
    const by = Object.fromEntries((await list({ page: 1 })).rows.map((r) => [r.student.fullName, r.fee]));
    expect(by).toEqual({ Asha: "overdue", Bala: "paid", Chitra: "due", Dev: null });
  });

  it("leaves a block out of the payload, and ignores its filter, when the viewer may not see it", async () => {
    const reader = { ...lctx, isOwner: false, permissions: ["students:read"] };
    const l = await list({ page: 1, fee: "overdue", programId: karate }, reader);
    expect(l.matched).toBe(4);
    expect(l.applied).toEqual({});
    expect(l.options).toEqual({});
    expect(l.shows).toEqual({ placements: false, attendance: false, fee: false });
    for (const r of l.rows) {
      expect(r).not.toHaveProperty("fee");
      expect(r).not.toHaveProperty("attendance");
      expect(r).not.toHaveProperty("placements");
    }
    await expect(list({ page: 1 }, { ...reader, permissions: [] })).rejects.toMatchObject({ status: 403 });
  });
});
