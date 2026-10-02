import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, todayIn } from "@/lib/dates";
import { rulesFor } from "@/modules/batches/repo";
import { startActivity } from "@/modules/billing/service";
import { rulesOn } from "@/modules/batches/schedule";
import { batches, programs } from "@/modules/batches/schema";
import {
  addHoliday,
  addProgram,
  archiveBatch,
  batchDetail,
  batchViews,
  changeSchedule,
  closeBatch,
  createBatch,
  holidayList,
  type NewBatchInput,
  removeHoliday,
  reopenBatch,
  requireBatch,
  weekCalendar,
} from "@/modules/batches/service";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext, setStaffBranches } from "@/modules/staff/service";
import { createBranch, createResource } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";

const stamp = Math.random().toString(36).slice(2, 8);
const today = todayIn("Asia/Kolkata");
const MWF = (start: string, end: string) => [1, 3, 5].map((weekday) => ({ weekday, startTime: start, endTime: end }));
let T = "";
let main = "";
let kothrud = "";
let owner: ScopedCtx;
let karate = "";
let coachAll = "";
let coachKothrud = "";
let room = "";
const roleIds: Record<string, string> = {};

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const staff = (name: string, role: string, branches: string[] = []) =>
  withTenant(T, async (tx) => {
    const s = await createStaffMember(tx, owner, { email: `${name.toLowerCase().replace(/\W/g, "")}-${stamp}@example.test`, fullName: name, roleId: roleIds[role] ?? "" });
    if (branches.length) await setStaffBranches(tx, owner, s.id, branches);
    return s.id;
  });
const create = (input: Partial<NewBatchInput>, ctx = owner) =>
  withTenant(T, (tx) => createBatch(tx, ctx, { name: "Beginners B", programId: karate, slots: MWF("18:00", "19:00"), startDate: addDays(today, -30), ...input }));

beforeAll(async () => {
  const t = await testAcademy({ name: `Batch Test ${stamp}`, slug: `bat-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `owner-${stamp}@example.test` } });
  T = t.tenant.id;
  main = t.branch.id;
  owner = await ctxFor(t.owner.id);
  kothrud = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Kothrud" }))).id;
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, (tx) => startActivity(tx, { tenantId: T, branchId: kothrud, activityKey: "karate", planId: t.subscription.planId, today, trial: false })); // each branch has its own; free, so it starts at once
  room = (await withTenant(T, (tx) => createResource(tx, { tenantId: T, branchId: main, name: "Main Hall", capacity: 40 }))).id;
  for (const r of await withTenant(T, listRoles)) roleIds[r.name] = r.id;
  karate = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  coachAll = await staff("Ravi Patil", "Teacher");
  coachKothrud = await staff("Kiran Kothrud", "Teacher", [kothrud]);
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("creating batches", () => {
  it("a Mon/Wed/Fri 6–7 PM batch has three rules and shows on exactly those days of the week calendar", async () => {
    const b = await create({ coachId: coachAll, resourceId: room, capacity: 30 });
    expect((await withTenant(T, (tx) => rulesFor(tx, [b.id]))).map((r) => [r.weekday, r.startTime, r.endTime])).toEqual([
      [1, "18:00", "19:00"],
      [3, "18:00", "19:00"],
      [5, "18:00", "19:00"],
    ]);
    const cal = await withTenant(T, (tx) => weekCalendar(tx, owner, { date: today }));
    const days = cal.days.filter((d) => d.blocks.some((x) => x.key === b.id)).map((d) => d.weekday);
    expect(days).toEqual([1, 3, 5]);
    const view = await withTenant(T, (tx) => batchDetail(tx, owner, b.id));
    expect(view).toMatchObject({ schedule: "Mon · Wed · Fri 6:00 – 7:00 PM", programName: "Karate", coachName: "Ravi Patil", resourceName: "Main Hall", capacity: 30 });
  });

  it("keeps different times on different days (tuition)", async () => {
    const b = await create({
      name: "Maths 9 A",
      slots: [
        { weekday: 1, startTime: "16:00", endTime: "17:00" },
        { weekday: 3, startTime: "16:00", endTime: "17:00" },
        { weekday: 6, startTime: "10:00", endTime: "11:30" },
      ],
    });
    expect((await withTenant(T, (tx) => batchDetail(tx, owner, b.id))).schedule).toBe("Mon · Wed 4:00 – 5:00 PM, Sat 10:00 – 11:30 AM");
  });

  it("creates the program inline, and reuses an existing one whatever its case", async () => {
    const first = await create({ name: "Dance A", programId: undefined, newProgramName: "Bharatanatyam" });
    const again = await create({ name: "Dance B", programId: undefined, newProgramName: "BHARATANATYAM " });
    expect(again.programId).toBe(first.programId);
    const rows = await withTenant(T, (tx) => tx.select({ id: programs.id }).from(programs).where(eq(programs.name, "Bharatanatyam")));
    expect(rows).toHaveLength(1);
    await expect(withTenant(T, (tx) => addProgram(tx, owner, { name: "karate" }))).rejects.toMatchObject({ status: 409 });
  });

  it("refuses bad input with plain messages", async () => {
    await expect(create({ slots: [] })).rejects.toThrow("Pick at least one day");
    await expect(create({ slots: [{ weekday: 2, startTime: "19:00", endTime: "18:30" }] })).rejects.toThrow("Tue: 24 hours is too long for one class. Check AM/PM.");
    await expect(create({ programId: undefined })).rejects.toThrow("Pick a program");
    await expect(create({ programId: "00000000-0000-7000-8000-000000000000" })).rejects.toMatchObject({ status: 404 });
    await expect(create({ coachId: "00000000-0000-7000-8000-000000000000" })).rejects.toMatchObject({ status: 404 });
    await expect(create({ coachId: coachKothrud })).rejects.toThrow("Kiran Kothrud doesn't work at this branch");
    await expect(create({ branchId: kothrud, resourceId: room })).rejects.toMatchObject({ status: 404, message: "Room not found" });
    await expect(create({ startDate: "2026-02-30" })).rejects.toThrow("Start date isn't a valid date");
  });
});

describe("changing the timing only affects dates from the change onward", () => {
  it("ends the old rules yesterday and starts the new ones today", async () => {
    const b = await create({ name: "Timing A" });
    await withTenant(T, (tx) => changeSchedule(tx, owner, b.id, { slots: MWF("19:00", "20:00") }));
    const rules = await withTenant(T, (tx) => rulesFor(tx, [b.id]));
    expect(rulesOn(rules, addDays(today, -1)).map((r) => r.startTime)).toEqual(["18:00", "18:00", "18:00"]);
    expect(rulesOn(rules, today).map((r) => r.startTime)).toEqual(["19:00", "19:00", "19:00"]);
    expect(rulesOn(rules, addDays(today, -30)).map((r) => r.startTime)).toEqual(["18:00", "18:00", "18:00"]);
    const [audit] = await withTenant(T, (tx) => tx.select({ before: auditLog.before, after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "batch.schedule.set"), eq(auditLog.entityId, b.id))));
    expect(audit).toMatchObject({ before: { schedule: "Mon · Wed · Fri 6:00 – 7:00 PM" }, after: { schedule: "Mon · Wed · Fri 7:00 – 8:00 PM", from: today } });
  });

  it("refuses a change dated in the past", async () => {
    const b = await create({ name: "Timing B" });
    await expect(withTenant(T, (tx) => changeSchedule(tx, owner, b.id, { slots: MWF("19:00", "20:00"), from: addDays(today, -1) }))).rejects.toThrow("can't start in the past");
  });

  it("a later change replaces a pending one that hasn't started", async () => {
    const b = await create({ name: "Timing C" });
    await withTenant(T, (tx) => changeSchedule(tx, owner, b.id, { slots: MWF("17:00", "18:00"), from: addDays(today, 14) }));
    expect((await withTenant(T, (tx) => batchDetail(tx, owner, b.id))).upcoming).toEqual({ from: addDays(today, 14), schedule: "Mon · Wed · Fri 5:00 – 6:00 PM" });
    await withTenant(T, (tx) => changeSchedule(tx, owner, b.id, { slots: MWF("16:00", "17:00"), from: addDays(today, 7) }));
    const rules = await withTenant(T, (tx) => rulesFor(tx, [b.id]));
    expect([...new Set(rules.map((r) => `${r.effectiveFrom}→${r.effectiveTo ?? "…"} ${r.startTime}`))]).toEqual([
      `${addDays(today, -30)}→${addDays(today, 6)} 18:00`,
      `${addDays(today, 7)}→… 16:00`,
    ]);
    expect((await withTenant(T, (tx) => batchDetail(tx, owner, b.id))).upcoming?.from).toBe(addDays(today, 7));
  });

  it("before a batch has started, its timing is simply replaced", async () => {
    const b = await create({ name: "Future", startDate: addDays(today, 10) });
    await withTenant(T, (tx) => changeSchedule(tx, owner, b.id, { slots: [{ weekday: 2, startTime: "07:00", endTime: "08:00" }] }));
    const rules = await withTenant(T, (tx) => rulesFor(tx, [b.id]));
    expect(rules.map((r) => [r.weekday, r.startTime, r.effectiveFrom, r.effectiveTo])).toEqual([[2, "07:00", addDays(today, 10), null]]);
  });
});

describe("closing and deleting", () => {
  it("close is reversible and blocks timing changes while closed", async () => {
    const b = await create({ name: "Closable" });
    const closed = await withTenant(T, (tx) => closeBatch(tx, owner, b.id));
    expect(closed).toMatchObject({ status: "ended", endDate: today });
    await expect(withTenant(T, (tx) => changeSchedule(tx, owner, b.id, { slots: MWF("19:00", "20:00") }))).rejects.toThrow("Reopen it to change the timing");
    await expect(withTenant(T, (tx) => closeBatch(tx, owner, b.id))).rejects.toMatchObject({ status: 409 });
    expect((await withTenant(T, (tx) => batchViews(tx, owner))).some((v) => v.id === b.id)).toBe(false);
    const reopened = await withTenant(T, (tx) => reopenBatch(tx, owner, b.id));
    expect(reopened).toMatchObject({ status: "active", endDate: null });
    await expect(withTenant(T, (tx) => closeBatch(tx, owner, b.id, { endDate: addDays(today, -31) }))).rejects.toThrow("before the batch started");
  });

  it("a batch without students is soft-deleted (enrollments test covers the refusal)", async () => {
    const b = await create({ name: "Deletable" });
    await withTenant(T, (tx) => archiveBatch(tx, owner, b.id));
    await expect(withTenant(T, (tx) => requireBatch(tx, owner, b.id))).rejects.toMatchObject({ status: 404 });
    const [row] = await withTenant(T, (tx) => tx.select({ d: batches.deletedAt }).from(batches).where(eq(batches.id, b.id)));
    expect(row?.d).not.toBeNull();
  });
});

describe("holidays", () => {
  it("one per date per branch, all-branch ones included everywhere, branch ones only there", async () => {
    const g = await withTenant(T, (tx) => addHoliday(tx, owner, { date: "2026-10-02", name: "Gandhi Jayanti" }));
    await expect(withTenant(T, (tx) => addHoliday(tx, owner, { date: "2026-10-02", name: "Again" }))).rejects.toMatchObject({ status: 409, message: "There's already a holiday on 2 Oct 2026" });
    const local = await withTenant(T, (tx) => addHoliday(tx, owner, { date: "2026-09-30", name: "Local festival", branchId: kothrud }));
    await withTenant(T, (tx) => addHoliday(tx, owner, { date: "2026-10-02", name: "Kothrud too", branchId: kothrud }));

    const mainDesk = await ctxFor(await staff("Main Manager", "Manager", [main]));
    const seen = (await withTenant(T, (tx) => holidayList(tx, mainDesk))).map((h) => h.name);
    expect(seen).toContain("Gandhi Jayanti");
    expect(seen).not.toContain("Local festival");
    expect((await withTenant(T, (tx) => holidayList(tx, owner))).map((h) => h.name)).toEqual(expect.arrayContaining(["Gandhi Jayanti", "Local festival", "Kothrud too"]));
    await expect(withTenant(T, (tx) => addHoliday(tx, mainDesk, { date: "2026-11-01", name: "Everywhere" }))).rejects.toThrow("Pick your branch");
    await expect(withTenant(T, (tx) => removeHoliday(tx, mainDesk, local.id))).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(T, (tx) => removeHoliday(tx, mainDesk, g.id))).rejects.toMatchObject({ status: 404 });
    await withTenant(T, (tx) => removeHoliday(tx, owner, local.id));
    expect((await withTenant(T, (tx) => holidayList(tx, owner))).map((h) => h.name)).not.toContain("Local festival");
  });

  it("marks the classes on a holiday in the week calendar", async () => {
    const b = await create({ name: "Holiday Check" });
    const cal = await withTenant(T, (tx) => weekCalendar(tx, owner, { date: "2026-10-02", branchId: main }));
    const fri = cal.days.find((d) => d.date === "2026-10-02");
    expect(fri?.holidays).toEqual(["Gandhi Jayanti"]);
    expect(fri?.blocks.find((x) => x.key === b.id)?.holiday).toBe("Gandhi Jayanti");
  });
});

describe("who can see and manage batches", () => {
  it("Front Desk and Teacher have no batches:read", async () => {
    for (const role of ["Front Desk", "Teacher"]) {
      const ctx = await ctxFor(await staff(`${role} Person`, role));
      await expect(withTenant(T, (tx) => batchViews(tx, ctx))).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("staff limited to one branch neither see nor create batches in another", async () => {
    const mainBatch = await create({ name: "Main only" });
    const kManager = await ctxFor(await staff("Kothrud Manager", "Manager", [kothrud]));
    expect((await withTenant(T, (tx) => batchViews(tx, kManager))).some((v) => v.id === mainBatch.id)).toBe(false);
    await expect(withTenant(T, (tx) => requireBatch(tx, kManager, mainBatch.id))).rejects.toMatchObject({ status: 404 });
    await expect(create({ name: "Sneaky", branchId: main }, kManager)).rejects.toMatchObject({ status: 404 });
    const own = await create({ name: "Kothrud Juniors", coachId: coachKothrud }, kManager);
    expect(own.branchId).toBe(kothrud);
  });
});
