import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { testAcademy } from "@/lib/db/isolation/academy";
import { withTenant } from "@/lib/db/with-tenant";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { insertInvoice } from "@/modules/fees/repo";
import { nextDue } from "@/modules/fees/service";
import { listRoles } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { staffBranchIds } from "@/modules/staff/repo";
import { addFamilyMember } from "./family";
import { profileTabs, studentProfile } from "./profile";
import { removeFamilyLink, updateGuardian, updateStudent } from "./repo";
import { createStudent, type StudentCtx } from "./service";

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let branch = "";
let owner: StudentCtx;
let teacher: StudentCtx;
let accountant: StudentCtx;
let batchId = "";
let phones = 0;
const phone = () => `+919${String(300_000_000 + ++phones).padStart(9, "0")}`;
const consents = { dataProcessing: true };

const ctxFor = async (staffId: string): Promise<StudentCtx> =>
  withTenant(T, async (tx) => ({ ...(await loadAccessContext(tx, staffId)), branchIds: await staffBranchIds(tx, staffId) }));

const kid = (fullName: string, relation: "father" | "mother" = "father") =>
  withTenant(T, (tx) => createStudent(tx, owner, { fullName, dateOfBirth: "2015-01-01", guardian: { fullName: `${fullName} Parent`, phone: phone(), relation }, consents }));
const profile = (ctx: StudentCtx, id: string) => withTenant(T, (tx) => studentProfile(tx, ctx, id));

beforeAll(async () => {
  const a = await testAcademy({ name: `Profile ${stamp}`, slug: `prf-${stamp}`, verticalPreset: "karate", owner: { name: "Coach Owner", email: `prf-${stamp}@example.test` } });
  T = a.tenant.id;
  branch = a.branch.id;
  owner = await ctxFor(a.owner.id);
  const roles = await withTenant(T, (tx) => listRoles(tx));
  const staff = (name: string, role: string) =>
    withTenant(T, async (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleId: roles.find((r) => r.name === role)?.id ?? "" }));
  teacher = await ctxFor((await staff("Teach", "Teacher")).id);
  accountant = await ctxFor((await staff("Acct", "Accountant")).id);
  const program = await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }));
  batchId = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Karate A", programId: program.id, coachId: a.owner.id, slots: [{ weekday: 1, startTime: "17:00", endTime: "18:00" }] }))).id;
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end();
});

describe("tabs follow permissions", () => {
  it("the owner is offered every tab, in order", () => {
    expect(profileTabs(owner)).toEqual(["overview", "attendance", "fees", "batches", "documents", "activity"]);
  });

  it("a viewer without invoices:read gets no fees tab, and no fee data in the payload", async () => {
    const s = await kid("Tab Kid");
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: s.student.id, batchId }));
    const tabs = profileTabs(teacher);
    expect(tabs).toEqual(["overview", "documents", "activity"]);
    const p = await profile(teacher, s.student.id);
    expect("nextDue" in p).toBe(false);
    expect("batches" in p).toBe(false);
    expect("attendance" in p).toBe(false);
    await expect(withTenant(T, (tx) => nextDue(tx, teacher, s.student.id))).rejects.toMatchObject({ status: 403 });
    // Positive control: the same student, seen by the owner, has both.
    const full = await profile(owner, s.student.id);
    expect(full.batches?.current).toHaveLength(1);
    expect(full.attendance?.trend).toHaveLength(6);
    expect(full).toHaveProperty("nextDue");
  });

  it("an accountant sees fees but not batches", async () => {
    const tabs = profileTabs(accountant);
    expect(tabs).toContain("fees");
    expect(tabs).not.toContain("batches");
    const p = await profile(accountant, (await kid("Acct Kid")).student.id);
    expect(p).toHaveProperty("nextDue");
    expect("batches" in p).toBe(false);
  });
});

describe("overview data", () => {
  it("lists every guardian with relation and manager, the student's own address, the coach, and the next due date", async () => {
    const a = await kid("Two Guardians");
    await withTenant(T, async (tx) => {
      await addFamilyMember(tx, owner, a.student.id, { fullName: "Second Parent", phone: phone(), relation: "mother" });
      await updateGuardian(tx, a.guardian.id, { email: "dad@example.test" });
      await updateStudent(tx, a.student.id, { address: "12 Lake Road" });
    });
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: a.student.id, batchId }));
    for (const [n, due] of [["I-1", "2026-11-20"], ["I-2", "2026-11-05"]] as const)
      await withTenant(T, (tx) => insertInvoice(tx, { tenantId: T, branchId: branch, studentId: a.student.id, number: n, fy: "2026-27", issuedAt: new Date("2026-10-01T05:00:00Z"), issueDate: "2026-10-01", dueDate: due, subtotalPaise: 50_000n, totalPaise: 50_000n, paidPaise: 0n, status: "issued" }));
    const p = await profile(owner, a.student.id);
    expect(p.guardians.map((g) => [g.relation, g.isManager])).toEqual([["father", true], ["mother", false]]);
    expect(p.guardians[0]?.email).toBe("dad@example.test");
    expect(p.student.address).toBe("12 Lake Road");
    expect(p.batches?.current[0]).toMatchObject({ batchName: "Karate A", programName: "Karate", coachName: "Coach Owner" });
    expect(p.nextDue).toBe("2026-11-05");
  });

  it("a student with no guardian at all resolves every block", async () => {
    const a = await kid("Adult Alone");
    // Positive control: one guardian before the link is removed.
    expect((await profile(owner, a.student.id)).guardians).toHaveLength(1);
    await withTenant(T, (tx) => removeFamilyLink(tx, a.student.id, a.guardian.id, new Date()));
    const p = await profile(owner, a.student.id);
    expect(p.guardians).toEqual([]);
    expect(p.siblings).toEqual([]);
    expect(p.batches).toEqual({ current: [], past: [] });
    expect(p.nextDue).toBeNull();
    expect(p.student.fullName).toBe("Adult Alone");
  });

  it("a removed guardian leaves the card but the student keeps their own history", async () => {
    const a = await kid("Kept History");
    const mum = await withTenant(T, (tx) => addFamilyMember(tx, owner, a.student.id, { fullName: "Mum Gone", phone: phone(), relation: "mother" }));
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: a.student.id, batchId }));
    await withTenant(T, (tx) => insertInvoice(tx, { tenantId: T, branchId: branch, studentId: a.student.id, number: "H-1", fy: "2026-27", issuedAt: new Date("2026-10-01T05:00:00Z"), issueDate: "2026-10-01", dueDate: "2026-11-01", subtotalPaise: 50_000n, totalPaise: 50_000n, paidPaise: 0n, status: "issued" }));
    expect((await profile(owner, a.student.id)).guardians.map((g) => g.id)).toContain(mum.id);
    await withTenant(T, (tx) => removeFamilyLink(tx, a.student.id, mum.id, new Date()));
    const p = await profile(owner, a.student.id);
    expect(p.guardians.map((g) => g.id)).toEqual([a.guardian.id]);
    expect(p.batches?.current).toHaveLength(1);
    expect(p.nextDue).toBe("2026-11-01");
  });
});
