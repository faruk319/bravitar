import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/can";
import { parseCsv, toCsv } from "@/lib/csv";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext, setStaffBranches } from "@/modules/staff/service";
import { buildErrorRows, suggestMapping } from "@/modules/students/import-fields";
import { type ImportResult, importStudents } from "@/modules/students/import";
import { findGuardianByPhone, guardiansOfHousehold, searchStudents, studentsOfHousehold } from "@/modules/students/repo";
import { consents, guardians, households, studentCodeSeries, students } from "@/modules/students/schema";
import { createStudent, type StudentCtx } from "@/modules/students/service";
import { createBranch } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let ownerCtx: StudentCtx;
let mainBranch = "";

const ctxFor = async (staffId: string, ip = "203.0.113.7"): Promise<StudentCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds, ip };
};
const run = (ctx: StudentCtx, csv: string, mapping: Record<string, number>, dryRun: boolean, options: Record<string, unknown> = {}) =>
  withTenant(T, (tx) => importStudents(tx, ctx, { csv, mapping, options: { consentDeclared: true, ...options } }, { dryRun }));
const counts = () =>
  withTenant(T, async (tx) => {
    const n = async (t: typeof students | typeof households | typeof guardians | typeof consents) => (await tx.select({ n: count() }).from(t))[0]?.n ?? 0;
    const [series] = await tx.select({ next: studentCodeSeries.nextValue }).from(studentCodeSeries);
    const [audit] = await tx.select({ n: count() }).from(auditLog);
    return { students: await n(students), households: await n(households), guardians: await n(guardians), consents: await n(consents), audit: audit?.n ?? 0, nextCode: series?.next ?? 1 };
  });
const summary = (r: ImportResult) => ({ ...r, errors: r.errors.map((e) => e.row), warnings: r.warnings.map((w) => w.row) });

const HEADER = "Name,Surname,Father's Name,Mobile,D.O.B,Gender,Branch,Joining Date,Photo";
const FIXTURE = [
  HEADER,
  "आरव,देशमुख,राकेश देशमुख,98765 11111,12/03/2015,M,,01/06/2024,haan", // 2 created, new family
  "Anaya,Deshmukh,राकेश देशमुख,+91 98765 11111,01-07-18,F,,,yes", // 3 sibling (same phone)
  "Kabir,,राकेश देशमुख,9876511111,2019-02-10,M,,,no", // 4 sibling, no last name
  "Meher,Kaur,,98765 22222,05 May 1998,F,,,", // 5 adult, own phone
  "Zoya,Shaikh,Sana Shaikh,12345,2014-11-20,F,,,", // 6 error: bad phone
  "Ishaan,Patil,Vikram Patil,,2016-01-30,M,,,", // 7 error: no phone
  "Rohan,Joshi,Priya Joshi,98765 33333,31/02/2013,M,,,", // 8 warning: bad date
  "Tara,Rao,Kiran Rao,98765 44444 / 98765 55555,2015-05-05,F,,,", // 9 warning: two numbers
  "Dev,Rao,Kiran Rao,98765 66666,2015-05-05,M,Kothrud,,", // 10 error: unknown branch
  "आरव,देशमुख,राकेश देशमुख,98765 11111,12/03/2015,M,,01/06/2024,haan", // 11 skipped: duplicate of 2
  ",,,,,,,,", // 12 blank
  "Aarav,Deshmukh,Rakesh Deshmukh,98765 00001,2015-03-12,M,,,", // 13 skipped: added by hand
  "Sara,Deshmukh,Sunita Deshmukh,98765 00001,2017-04-04,F,,,", // 14 linked to existing family, warning
  "Nikhil,Mehta,,98765 77777,2016-06-06,M,,,", // 15 warning: no parent name
  "Arjun,Mehta,,98765 77777,1990-01-01,M,,,", // 16 adult sharing that phone, warning
  "A,,Someone,98765 88888,,,,,", // 17 error: name too short
  '"Shah, Riya",,Amit Shah,98765 99999,2016-09-09,F,,,', // 18 quoted comma
].join("\r\n");
const MAPPING = { firstName: 0, lastName: 1, guardianName: 2, guardianPhone: 3, dateOfBirth: 4, gender: 5, branch: 6, joinedOn: 7, photoConsent: 8 };
const EXPECTED = { rows: 16, studentsCreated: 10, householdsCreated: 6, linkedToExisting: 1, skipped: 2, errors: [6, 7, 10, 17], warnings: [8, 9, 14, 15, 16] };

beforeAll(async () => {
  const created = await testAcademy({ name: `Import Test ${stamp}`, slug: `imp-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `owner-${stamp}@example.test` } });
  T = created.tenant.id;
  mainBranch = created.branch.id;
  ownerCtx = await ctxFor(created.owner.id);
  // A student added by hand before the import.
  await withTenant(T, (tx) =>
    createStudent(tx, ownerCtx, { fullName: "Aarav Deshmukh", dateOfBirth: "2015-03-12", guardian: { fullName: "Rakesh Deshmukh", phone: "9876500001", relation: "father" }, consents: { dataProcessing: true } }),
  );
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("student CSV import", () => {
  it("auto-maps the fixture header the way the test maps it", () => {
    expect(suggestMapping(HEADER.split(",")).mapping).toEqual(MAPPING);
  });

  it("dry run predicts every row and leaves no trace", async () => {
    const before = await counts();
    const r = await run(ownerCtx, FIXTURE, MAPPING, true);
    expect(summary(r)).toEqual({ dryRun: true, ...EXPECTED });
    expect(r.errors.map((e) => e.message)).toEqual(['Phone "12345" isn\'t a 10-digit mobile', "No phone number", 'Unknown branch "Kothrud"', "Name is too short"]);
    expect(r.warnings.map((w) => w.message)).toEqual([
      'Couldn\'t read date of birth "31/02/2013"; left blank',
      "Kept +91 98765 44444; dropped +91 98765 55555",
      "Phone belongs to Rakesh Deshmukh; added to that family",
      'No parent name; saved as "Parent of Nikhil Mehta"',
      "Shares a phone with Parent of Nikhil Mehta; added to that family",
    ]);
    expect(await counts()).toEqual(before);
  });

  it("refuses to import without the consent declaration", async () => {
    await expect(run(ownerCtx, FIXTURE, MAPPING, false, { consentDeclared: false })).rejects.toThrow(/Confirm that parents gave consent/);
  });

  it("commits exactly what the dry run predicted, with contiguous codes and one summary audit row", async () => {
    const before = await counts();
    const r = await run(ownerCtx, FIXTURE, MAPPING, false);
    expect(summary(r)).toEqual({ dryRun: false, ...EXPECTED });
    const after = await counts();
    expect(after.students - before.students).toBe(10);
    expect(after.households - before.households).toBe(6);
    expect(after.nextCode - before.nextCode).toBe(10);
    const [row] = await withTenant(T, (tx) => tx.select({ after: auditLog.after }).from(auditLog).where(eq(auditLog.action, "students.import")));
    expect(row?.after).toMatchObject({ rows: 16, studentsCreated: 10, errors: 4, warnings: 5 });
  });

  it("keeps a family that shares one phone together: one guardian row, three siblings", async () => {
    const { kids, parents } = await withTenant(T, async (tx) => {
      const g = await findGuardianByPhone(tx, "+919876511111");
      return { kids: await studentsOfHousehold(tx, g?.householdId ?? ""), parents: await guardiansOfHousehold(tx, g?.householdId ?? "") };
    });
    expect(kids.map((k) => k.fullName).sort()).toEqual(["Anaya Deshmukh", "Kabir", "आरव देशमुख"]);
    expect(parents.map((p) => p.fullName)).toEqual(["राकेश देशमुख"]);
  });

  it("joins the hand-added family instead of duplicating it", async () => {
    const kids = await withTenant(T, async (tx) => studentsOfHousehold(tx, (await findGuardianByPhone(tx, "+919876500001"))?.householdId ?? ""));
    expect(kids.map((k) => k.fullName).sort()).toEqual(["Aarav Deshmukh", "Sara Deshmukh"]);
  });

  it("stores Devanagari exactly and finds it by search", async () => {
    const found = await withTenant(T, (tx) => searchStudents(tx, { branchIds: [] }, { q: "आरव" }));
    expect(found.map((f) => f.student.fullName)).toEqual(["आरव देशमुख"]);
  });

  it("records consent as declared on paper, by the importer, and tags the audit row", async () => {
    const [s] = await withTenant(T, (tx) => tx.select().from(students).where(eq(students.fullName, "आरव देशमुख")));
    const rows = await withTenant(T, (tx) => tx.select().from(consents).where(eq(consents.studentId, s?.id ?? "")));
    const dp = rows.find((c) => c.kind === "data_processing");
    expect(dp).toMatchObject({ granted: true, method: "paper", grantedIp: "203.0.113.7" });
    expect(dp?.guardianId).toBe((await withTenant(T, (tx) => findGuardianByPhone(tx, "+919876511111")))?.id);
    expect(rows.find((c) => c.kind === "photo")?.granted).toBe(true);
    const [kabir] = await withTenant(T, (tx) => tx.select({ id: students.id }).from(students).where(eq(students.fullName, "Kabir")));
    const kabirPhoto = await withTenant(T, (tx) => tx.select({ granted: consents.granted }).from(consents).where(and(eq(consents.studentId, kabir?.id ?? ""), eq(consents.kind, "photo"))));
    expect(kabirPhoto).toEqual([{ granted: false }]);
    const [meher] = await withTenant(T, (tx) => tx.select({ id: students.id, phone: students.phone }).from(students).where(eq(students.fullName, "Meher Kaur")));
    expect(meher?.phone).toBe("+919876522222");
    expect((await withTenant(T, (tx) => tx.select().from(consents).where(eq(consents.studentId, meher?.id ?? "")))).map((c) => c.kind)).toEqual(["data_processing"]);
    const [audit] = await withTenant(T, (tx) => tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "student.create"), eq(auditLog.entityId, s?.id ?? ""))));
    expect(audit?.after).toMatchObject({ source: "csv_import" });
  });

  it("re-running the same file creates nothing", async () => {
    const before = await counts();
    const r = await run(ownerCtx, FIXTURE, MAPPING, false);
    expect(summary(r)).toEqual({ dryRun: false, rows: 16, studentsCreated: 0, householdsCreated: 0, linkedToExisting: 0, skipped: 12, errors: [6, 7, 10, 17], warnings: [] });
    const after = await counts();
    expect(after.students).toBe(before.students);
    expect(after.nextCode).toBe(before.nextCode);
  });

  it("treats Devanagari nukta spellings as the same name on re-import", async () => {
    const m = { fullName: 0, guardianName: 1, guardianPhone: 2, dateOfBirth: 3 };
    const first = await run(ownerCtx, "Name,Parent,Phone,DOB\nज़ोया खान,Imran Khan,91234 00001,2016-01-01\n", m, false);
    expect(first.studentsCreated).toBe(1);
    const again = await run(ownerCtx, "Name,Parent,Phone,DOB\nज़ोया खान,Imran Khan,91234 00001,2016-01-01\n", m, false);
    expect(again).toMatchObject({ studentsCreated: 0, skipped: 1 });
  });

  it("builds an error CSV that opens back as the failed rows plus reasons", async () => {
    const r = await run(ownerCtx, FIXTURE, MAPPING, true);
    const records = parseCsv(FIXTURE);
    const csv = toCsv(buildErrorRows(records[0] ?? [], records, r.errors));
    const back = parseCsv(csv);
    expect(back).toHaveLength(5);
    expect(back[0]?.at(-1)).toBe("Import error");
    expect(back.slice(1).map((row) => [row[0], row.at(-1)])).toEqual([
      ["Zoya", 'Phone "12345" isn\'t a 10-digit mobile'],
      ["Ishaan", "No phone number"],
      ["Dev", 'Unknown branch "Kothrud"'],
      ["A", "Name is too short"],
    ]);
  });
});

describe("who can import, and where", () => {
  it("a Teacher cannot import", async () => {
    const teacher = await withTenant(T, async (tx) => {
      const roles = await listRoles(tx);
      return createStaffMember(tx, ownerCtx, { email: `teacher-${stamp}@example.test`, fullName: "Teacher", roleId: roles.find((r) => r.name === "Teacher")?.id ?? "" });
    });
    await expect(run(await ctxFor(teacher.id), FIXTURE, MAPPING, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("staff limited to one branch cannot import into another", async () => {
    const other = await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Other Centre" }));
    const desk = await withTenant(T, async (tx) => {
      const roles = await listRoles(tx);
      const s = await createStaffMember(tx, ownerCtx, { email: `desk-${stamp}@example.test`, fullName: "Desk", roleId: roles.find((r) => r.name === "Front Desk")?.id ?? "" });
      await setStaffBranches(tx, ownerCtx, s.id, [mainBranch]);
      return s;
    });
    const deskCtx = await ctxFor(desk.id);
    const csv = "Name,Phone,Branch\nPooja Iyer,91234 00002,Other Centre\n";
    const m = { fullName: 0, guardianPhone: 1, branch: 2 };
    expect((await run(deskCtx, csv, m, true)).errors).toEqual([{ row: 2, message: 'Unknown branch "Other Centre"' }]);
    await expect(run(deskCtx, "Name,Phone\nPooja Iyer,91234 00002\n", { fullName: 0, guardianPhone: 1 }, true, { defaultBranchId: other.id })).rejects.toMatchObject({ status: 404 });
    expect((await run(ownerCtx, csv, m, true)).studentsCreated).toBe(1);
  });
});

describe("concurrency and size", () => {
  it("two imports of the same file at once create each student once", async () => {
    const csv = ["Name,Parent,Phone,DOB", ...Array.from({ length: 4 }, (_, i) => `Twin ${i},Parent ${i},91230 1000${i},2015-01-01`)].join("\n");
    const m = { fullName: 0, guardianName: 1, guardianPhone: 2, dateOfBirth: 3 };
    const [a, b] = await Promise.all([run(ownerCtx, csv, m, false), run(ownerCtx, csv, m, false)]);
    expect([a.studentsCreated, b.studentsCreated].sort()).toEqual([0, 4]);
    expect([a.skipped, b.skipped].sort()).toEqual([0, 4]);
    const [n] = await withTenant(T, (tx) => tx.select({ n: count() }).from(students).where(sql`${students.fullName} LIKE 'Twin %'`));
    expect(n?.n).toBe(4);
  });

  it("imports 500 rows in reasonable time (reported)", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => `Bulk Student ${i},Bulk Parent ${Math.floor(i / 2)},97${String(10_000_000 + Math.floor(i / 2)).padStart(8, "0")},2014-0${(i % 9) + 1}-1${i % 9}`);
    const csv = ["Name,Parent,Phone,DOB", ...rows].join("\n");
    const m = { fullName: 0, guardianName: 1, guardianPhone: 2, dateOfBirth: 3 };
    let t = performance.now();
    const dry = await run(ownerCtx, csv, m, true);
    const dryMs = Math.round(performance.now() - t);
    t = performance.now();
    const real = await run(ownerCtx, csv, m, false);
    const realMs = Math.round(performance.now() - t);
    console.log(`500-row import: dry run ${dryMs} ms, commit ${realMs} ms`);
    expect(dry).toMatchObject({ studentsCreated: 500, householdsCreated: 250, errors: [] });
    expect(real).toMatchObject({ studentsCreated: 500, householdsCreated: 250, errors: [] });
  }, 120_000);
});

