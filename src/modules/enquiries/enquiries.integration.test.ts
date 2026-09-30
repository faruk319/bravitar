import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addProgram, createBatch } from "@/modules/batches/service";
import { dashboardData } from "@/modules/dashboard/service";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { tenantToday } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { activitiesOf } from "./repo";
import { createEnquiry, editEnquiry, enquiryBoard, logActivity, markLost, myFollowUps, phoneMatches, reopenEnquiry } from "./service";

// docs/03 §4 and docs/06 Prompt 18: adding in 15 seconds, the board, the
// timeline, follow-ups and lost reasons (agreed 2026-09-25).

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let teacher: ScopedCtx;
let karate = "";
let dance = "";
let evening = "";
let today = "";

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const add = (ctx: ScopedCtx, name: string, phone: string, extra: object = {}) => withTenant(T, (tx) => createEnquiry(tx, ctx, { name, phone, programId: karate, ...extra }));
const timeline = async (id: string) => (await withTenant(T, (tx) => activitiesOf(tx, id))).map((a) => (a.toStatus ? `${a.kind}>${a.toStatus}` : a.kind)).reverse();

beforeAll(async () => {
  const t = await testAcademy({ name: `Enq ${stamp}`, slug: `enq-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `enq-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  owner = await ctxFor(t.owner.id);
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  const hire = async (name: string, role: string) => ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleIds: [roles[role] ?? ""] }))).id);
  desk = await hire("desk", "Front Desk");
  teacher = await hire("teacher", "Teacher");
  karate = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  dance = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Dance" }))).id;
  evening = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Evening", programId: karate, slots: [{ weekday: 1, startTime: "18:00", endTime: "19:00" }], startDate: "2026-10-01" }))).id;
  today = await withTenant(T, tenantToday);
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("adding an enquiry", () => {
  it("name, phone and program are enough: follow-up tomorrow, assigned to whoever added it, the timeline starts", async () => {
    const e = await add(desk, "Aarav", "98765 11111");
    expect(e).toMatchObject({ status: "new", phone: "+919876511111", nextFollowUp: addDays(today, 1), ownerStaffId: desk.staffId, createdBy: desk.staffId });
    expect(await timeline(e.id)).toEqual(["status_change>new"]);
    await expect(withTenant(T, (tx) => createEnquiry(tx, desk, { name: "No Program", phone: "98765 11112" } as never))).rejects.toThrow();
    await expect(add(desk, "Bad Phone", "12345")).rejects.toThrow("10-digit");
    await expect(add(desk, "Wrong Batch", "98765 11113", { programId: dance, batchId: evening })).rejects.toThrow("another program");
  });

  it("a phone already on an open enquiry or a family is flagged, never blocked", async () => {
    await add(desk, "Riya", "98765 22222");
    expect((await add(desk, "Riya again", "98765 22222")).status).toBe("new");
    await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Kabir", guardian: { fullName: "Sunita Sharma", phone: "98765 33333", relation: "mother" }, consents: { dataProcessing: true } }));
    const onEnquiry = await withTenant(T, (tx) => phoneMatches(tx, desk, "98765 22222"));
    expect(onEnquiry.enquiries.map((m) => m.name).sort()).toEqual(["Riya", "Riya again"]);
    const onFamily = await withTenant(T, (tx) => phoneMatches(tx, desk, "+919876533333"));
    expect(onFamily.family).toMatchObject({ guardianName: "Sunita Sharma", students: ["Kabir"] });
  });
});

describe("working an enquiry", () => {
  it("a note alone changes nothing; the first call moves it to Contacted and sets the next follow-up", async () => {
    const e = await add(desk, "Zoya", "98765 44444");
    await expect(withTenant(T, (tx) => logActivity(tx, desk, e.id, { kind: "note" }))).rejects.toThrow("Write the note");
    expect((await withTenant(T, (tx) => logActivity(tx, desk, e.id, { kind: "note", note: "Mother will call back" }))).status).toBe("new");
    const after = await withTenant(T, (tx) => logActivity(tx, desk, e.id, { kind: "call", note: "Wants evenings", nextFollowUp: addDays(today, 3) }));
    expect(after).toMatchObject({ status: "contacted", nextFollowUp: addDays(today, 3) });
    expect(after.contactedAt).toBeInstanceOf(Date);
    expect(await timeline(e.id)).toEqual(["status_change>new", "note", "call>contacted"]); // the call is the one entry
  });

  it("lost needs a reason from the list; reopening goes back to Contacted with a follow-up tomorrow", async () => {
    const e = await add(desk, "Ishaan", "98765 55555");
    await expect(withTenant(T, (tx) => markLost(tx, desk, e.id, { reason: "cheap" as never }))).rejects.toThrow();
    const lost = await withTenant(T, (tx) => markLost(tx, desk, e.id, { reason: "fees", note: "Found cheaper nearby" }));
    expect(lost).toMatchObject({ status: "lost", lostReason: "fees", lostNote: "Found cheaper nearby", nextFollowUp: null });
    await expect(withTenant(T, (tx) => markLost(tx, desk, e.id, { reason: "timing" }))).rejects.toThrow("Already lost");
    const back = await withTenant(T, (tx) => reopenEnquiry(tx, desk, e.id));
    expect(back).toMatchObject({ status: "contacted", lostReason: null, lostAt: null, nextFollowUp: addDays(today, 1) });
    expect(await timeline(e.id)).toEqual(["status_change>new", "status_change>lost", "status_change>contacted"]);
  });
});

describe("the board and follow-ups", () => {
  it("follow-ups due today or earlier, mine first; the assigned person sees theirs on the dashboard", async () => {
    const [mine, theirs, later] = [await add(desk, "Meher", "98765 66666"), await add(owner, "Rohan", "98765 77777"), await add(desk, "Anaya", "98765 88888")];
    await withTenant(T, (tx) => editEnquiry(tx, desk, mine.id, { nextFollowUp: today }));
    await withTenant(T, (tx) => editEnquiry(tx, owner, theirs.id, { nextFollowUp: addDays(today, -2) }));
    await withTenant(T, (tx) => editEnquiry(tx, desk, later.id, { nextFollowUp: addDays(today, 5) }));

    const board = await withTenant(T, (tx) => enquiryBoard(tx, desk, "follow_ups"));
    expect(board.rows.map((r) => r.name)).toEqual(["Meher", "Rohan"]);
    expect(board.counts).toMatchObject({ follow_ups: 2, lost: 0 });
    expect((await withTenant(T, (tx) => myFollowUps(tx, desk))).map((r) => r.name)).toEqual(["Meher"]);
    expect((await withTenant(T, (tx) => dashboardData(tx, owner))).pipeline?.mine.map((r) => r.name)).toEqual(["Rohan"]);
    expect((await withTenant(T, (tx) => enquiryBoard(tx, desk, "contacted"))).rows.map((r) => r.name).sort()).toEqual(["Ishaan", "Zoya"]);
  });

  it("a teacher can't see or add enquiries", async () => {
    await expect(withTenant(T, (tx) => enquiryBoard(tx, teacher, "new"))).rejects.toMatchObject({ status: 403 });
    await expect(add(teacher, "Nope", "98765 99999")).rejects.toMatchObject({ status: 403 });
  });
});
