import { and, asc, eq, gt, lte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { createBoss } from "@/lib/jobs/boss";
import { addDays, timeIn, todayIn, weekdayOf } from "@/lib/dates";
import { closeRulesFrom, createHoliday, createProgram, insertBatch, insertRules } from "@/modules/batches/repo";
import type { Slot } from "@/modules/batches/schedule";
import { addHoliday, archiveBatch, changeSchedule, closeBatch, createBatch, removeHoliday, reopenBatch } from "@/modules/batches/service";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createBranch } from "@/modules/tenancy/repo";
import { tenants } from "@/modules/tenancy/schema";
import { testAcademy } from "@/lib/db/isolation/academy";
import { runSessionsGenerate, SESSIONS_GENERATE, workSessionsGenerate } from "./job";
import { HOLIDAY_REASON, reconcileSessions } from "./reconcile";
import { setSessionStatus } from "./repo";
import { type Session, sessions } from "./schema";

const stamp = Math.random().toString(36).slice(2, 8);
const IST = "Asia/Kolkata";
const NY = "America/New_York";
const DAY = 86_400_000;
const created: string[] = [];
type T = { id: string; branch: string; program: string; owner: ScopedCtx };

async function tenant(key: string, timezone = IST): Promise<T> {
  const t = await testAcademy({ name: `Sessions ${key} ${stamp}`, slug: `ses-${key}-${stamp}`, timezone, owner: { name: "Owner", email: `ses-${key}-${stamp}@example.test` } });
  created.push(t.tenant.id);
  const [base, branchIds] = await withTenant(t.tenant.id, async (tx) => [await loadAccessContext(tx, t.owner.id), await staffBranchIds(tx, t.owner.id)] as const);
  const program = await withTenant(t.tenant.id, (tx) => createProgram(tx, { tenantId: t.tenant.id, name: "Karate", activityKey: "general" }));
  return { id: t.tenant.id, branch: t.branch.id, program: program.id, owner: { ...base, branchIds } };
}

const days = (weekdays: number[], startTime: string, endTime: string): Slot[] => weekdays.map((weekday) => ({ weekday, startTime, endTime }));
let batchNo = 0;
// Straight through the repo (no reconcile hook), so a test can pick its own clock.
const rawBatch = (t: T, slots: Slot[], startDate: string) =>
  withTenant(t.id, async (tx) => {
    const b = await insertBatch(tx, { tenantId: t.id, branchId: t.branch, programId: t.program, name: `Batch ${++batchNo}`, startDate });
    await insertRules(tx, t.id, b.id, slots, startDate);
    return b.id;
  });
const reconcile = (t: T, now: Date, batchIds?: string[]) => withTenant(t.id, (tx) => reconcileSessions(tx, { now, ...(batchIds ? { batchIds } : {}) }));
const rows = (t: T, batchId: string): Promise<Session[]> => withTenant(t.id, (tx) => tx.select().from(sessions).where(eq(sessions.batchId, batchId)).orderBy(asc(sessions.startsAt)));
const iso = (d: Date) => d.toISOString().replace(".000", "");
// Past classes for a batch created "now": generate from an earlier clock, then refill the window.
const withHistory = async (t: T, batchId: string, daysBack: number) => {
  await reconcile(t, new Date(Date.now() - daysBack * DAY), [batchId]);
  await reconcile(t, new Date(), [batchId]);
};

let ist: T;
let ny: T;
let live: T;

beforeAll(async () => {
  [ist, ny, live] = await Promise.all([tenant("ist"), tenant("ny", NY), tenant("live")]);
});

afterAll(async () => {
  await deleteTenantsCompletely(created);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("generation (fixed clock, Asia/Kolkata)", () => {
  const now = new Date("2026-09-30T18:30:00Z"); // 1 Oct 2026, 00:00 IST
  let mwf = "";

  it("docs/03: Mon/Wed/Fri 6–7 PM from the 1st gives exactly the right dates for 30 days, skipping the holiday", async () => {
    await withTenant(ist.id, (tx) => createHoliday(tx, { tenantId: ist.id, branchId: null, date: "2026-10-02", name: "Gandhi Jayanti" }));
    mwf = await rawBatch(ist, days([1, 3, 5], "18:00", "19:00"), "2026-10-01");
    const r = await reconcile(ist, now, [mwf]);
    const all = await rows(ist, mwf);
    expect(all.filter((s) => s.sessionDate <= "2026-10-30").map((s) => s.sessionDate)).toEqual([
      "2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16",
      "2026-10-19", "2026-10-21", "2026-10-23", "2026-10-26", "2026-10-28", "2026-10-30",
    ]);
    expect(all.every((s) => iso(s.startsAt) === `${s.sessionDate}T12:30:00Z` && iso(s.endsAt) === `${s.sessionDate}T13:30:00Z` && s.status === "scheduled")).toBe(true);
    expect(r).toEqual({ created: 25, cancelled: 0, restored: 0, removed: 0 });
    expect(all.at(-1)?.sessionDate).toBe("2026-11-30"); // day 60 included
  });

  it("re-running creates nothing and keeps every id; a later run only adds the new last day", async () => {
    const before = (await rows(ist, mwf)).map((s) => s.id);
    expect(await reconcile(ist, now, [mwf])).toEqual({ created: 0, cancelled: 0, restored: 0, removed: 0 });
    expect((await rows(ist, mwf)).map((s) => s.id)).toEqual(before);
    expect(await reconcile(ist, new Date(now.getTime() + 2 * DAY), [mwf])).toEqual({ created: 1, cancelled: 0, restored: 0, removed: 0 }); // Wed 2 Dec
  });

  it("two runs at the same moment still give one row per class", async () => {
    const id = await rawBatch(ist, days([2, 4], "16:00", "17:00"), "2026-10-01");
    const results = await Promise.all([reconcile(ist, now, [id]), reconcile(ist, now, [id])]);
    const all = await rows(ist, id);
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(all.length);
    expect(new Set(all.map((s) => s.sessionDate)).size).toBe(all.length);
  });

  it("the 5:30 AM class is 00:00 UTC on its own local date; 5:00 AM Tuesday is Monday 23:30 UTC", async () => {
    const early = await rawBatch(ist, days([2, 4], "05:30", "06:30"), "2026-10-01");
    const five = await rawBatch(ist, days([2], "05:00", "06:00"), "2026-10-01");
    await reconcile(ist, now, [early, five]);
    const e = await rows(ist, early);
    expect(e.slice(0, 3).map((s) => [s.sessionDate, iso(s.startsAt)])).toEqual([
      ["2026-10-01", "2026-10-01T00:00:00Z"],
      ["2026-10-06", "2026-10-06T00:00:00Z"],
      ["2026-10-08", "2026-10-08T00:00:00Z"],
    ]);
    expect(e.every((s) => [2, 4].includes(weekdayOf(s.sessionDate)) && timeIn(IST, s.startsAt) === "05:30")).toBe(true);
    const f = await rows(ist, five);
    expect([f[0]?.sessionDate, iso(f[0]?.startsAt ?? new Date(0))]).toEqual(["2026-10-06", "2026-10-05T23:30:00Z"]);
    expect(f.every((s) => weekdayOf(s.sessionDate) === 2)).toBe(true);
  });

  it("a class crossing midnight belongs to the day it starts and ends the next morning", async () => {
    const late = await rawBatch(ist, days([6], "23:00", "01:00"), "2026-10-01");
    await reconcile(ist, now, [late]);
    const [first] = await rows(ist, late);
    expect([first?.sessionDate, iso(first?.startsAt ?? new Date(0)), iso(first?.endsAt ?? new Date(0))]).toEqual(["2026-10-03", "2026-10-03T17:30:00Z", "2026-10-03T19:30:00Z"]);
    expect(todayIn(IST, first?.endsAt ?? new Date(0))).toBe("2026-10-04");
  });

  it("a timing change made after today's class started doesn't add a second class today", async () => {
    const id = await rawBatch(ist, days([1, 3, 5], "18:00", "19:00"), "2026-10-01");
    await reconcile(ist, new Date("2026-10-05T11:30:00Z"), [id]); // Mon 5 Oct, 5:00 PM
    await withTenant(ist.id, async (tx) => {
      await closeRulesFrom(tx, id, "2026-10-05");
      await insertRules(tx, ist.id, id, days([1, 3, 5], "19:00", "20:00"), "2026-10-05");
    });
    const later = new Date("2026-10-05T13:00:00Z"); // 6:30 PM, class under way
    await reconcile(ist, later, [id]);
    const all = await rows(ist, id);
    expect(all.filter((s) => s.sessionDate === "2026-10-05").map((s) => timeIn(IST, s.startsAt))).toEqual(["18:00"]);
    expect(all.filter((s) => s.startsAt > later).every((s) => timeIn(IST, s.startsAt) === "19:00")).toBe(true);
    expect(all.find((s) => s.sessionDate === "2026-10-07")?.startsAt.toISOString()).toBe("2026-10-07T13:30:00.000Z");
  });
});

describe("daylight saving (America/New_York)", () => {
  it("fall back: 1:30 AM takes the first one and lasts an hour; 6 PM stays 6 PM", async () => {
    const night = await rawBatch(ny, days([0], "01:30", "02:30"), "2026-10-20");
    const evening = await rawBatch(ny, days([0], "18:00", "19:00"), "2026-10-20");
    await reconcile(ny, new Date("2026-10-20T12:00:00Z"), [night, evening]);
    const n = (await rows(ny, night)).find((s) => s.sessionDate === "2026-11-01");
    expect([iso(n?.startsAt ?? new Date(0)), iso(n?.endsAt ?? new Date(0))]).toEqual(["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]);
    const e = (await rows(ny, evening)).filter((s) => s.sessionDate === "2026-10-25" || s.sessionDate === "2026-11-01");
    expect(e.map((s) => iso(s.startsAt))).toEqual(["2026-10-25T22:00:00Z", "2026-11-01T23:00:00Z"]);
  });

  it("spring forward: 2:30 AM doesn't exist on 14 Mar 2027, so that class runs 3:30–4:30 AM", async () => {
    const id = await rawBatch(ny, days([0], "02:30", "03:30"), "2027-03-01");
    await reconcile(ny, new Date("2027-03-01T12:00:00Z"), [id]);
    const r = (await rows(ny, id)).slice(0, 3);
    expect(r.map((s) => [s.sessionDate, iso(s.startsAt), iso(s.endsAt)])).toEqual([
      ["2027-03-07", "2027-03-07T07:30:00Z", "2027-03-07T08:30:00Z"], // 2:30 EST
      ["2027-03-14", "2027-03-14T07:30:00Z", "2027-03-14T08:30:00Z"], // 3:30 EDT
      ["2027-03-21", "2027-03-21T06:30:00Z", "2027-03-21T07:30:00Z"], // 2:30 EDT
    ]);
  });
});

describe("changes made in the app (real clock)", () => {
  const MWF = days([1, 3, 5], "18:00", "19:00");
  const nextWeekday = (from: string, weekday: number) => {
    let d = from;
    while (weekdayOf(d) !== weekday) d = addDays(d, 1);
    return d;
  };

  it("changing 6 PM to 7 PM moves future classes only; past ones keep their ids and time", async () => {
    const today = todayIn(IST);
    const b = await withTenant(live.id, (tx) => createBatch(tx, live.owner, { name: "Timing", programId: live.program, slots: MWF, startDate: addDays(today, -40) }));
    await withHistory(live, b.id, 30);
    const now = new Date();
    const past = (await rows(live, b.id)).filter((s) => s.startsAt <= now);
    expect(past.length).toBeGreaterThan(10);
    await withTenant(live.id, (tx) => changeSchedule(tx, live.owner, b.id, { slots: days([1, 3, 5], "19:00", "20:00") }));
    const after = await rows(live, b.id);
    const t = new Date();
    expect(after.filter((s) => s.startsAt <= now).map((s) => [s.id, iso(s.startsAt)])).toEqual(past.map((s) => [s.id, iso(s.startsAt)]));
    expect(past.every((s) => timeIn(IST, s.startsAt) === "18:00")).toBe(true);
    expect(after.filter((s) => s.startsAt > t).every((s) => timeIn(IST, s.startsAt) === "19:00")).toBe(true);
    const dates = after.map((s) => s.sessionDate);
    expect(new Set(dates).size).toBe(dates.length); // never two on one day
    for (let d = addDays(today, 1); d <= addDays(today, 60); d = addDays(d, 1)) expect(dates.includes(d)).toBe([1, 3, 5].includes(weekdayOf(d)));
  });

  it("a holiday added later cancels that day's class; removing it brings the class back", async () => {
    const today = todayIn(IST);
    const kothrud = await withTenant(live.id, (tx) => createBranch(tx, { tenantId: live.id, name: `Kothrud ${stamp}` }));
    const b = await withTenant(live.id, (tx) => createBatch(tx, live.owner, { name: "Holidays", programId: live.program, slots: MWF, startDate: addDays(today, -7) }));
    const mon = nextWeekday(addDays(today, 8), 1);
    const wed = addDays(mon, 2);
    const fri = addDays(mon, 4);
    const on = async (date: string) => (await rows(live, b.id)).find((s) => s.sessionDate === date);
    const monId = (await on(mon))?.id;
    expect((await on(mon))?.status).toBe("scheduled");

    const h = await withTenant(live.id, (tx) => addHoliday(tx, live.owner, { date: mon, name: "Founders Day" }));
    expect(await on(mon)).toMatchObject({ id: monId, status: "cancelled", cancelReason: HOLIDAY_REASON });
    await withTenant(live.id, (tx) => addHoliday(tx, live.owner, { date: wed, name: "Kothrud fair", branchId: kothrud.id }));
    expect((await on(wed))?.status).toBe("scheduled"); // another branch's holiday

    const friRow = await on(fri);
    await withTenant(live.id, (tx) => setSessionStatus(tx, [friRow?.id ?? ""], "cancelled", "Coach unwell"));
    const h2 = await withTenant(live.id, (tx) => addHoliday(tx, live.owner, { date: fri, name: "Local holiday" }));
    await withTenant(live.id, (tx) => removeHoliday(tx, live.owner, h2.id));
    expect(await on(fri)).toMatchObject({ status: "cancelled", cancelReason: "Coach unwell" }); // a manual cancel stays

    await withTenant(live.id, (tx) => removeHoliday(tx, live.owner, h.id));
    expect(await on(mon)).toMatchObject({ id: monId, status: "scheduled", cancelReason: null });
  });

  it("a date that was already a holiday is simply skipped by a new batch", async () => {
    const today = todayIn(IST);
    const mon = nextWeekday(addDays(today, 20), 1);
    await withTenant(live.id, (tx) => addHoliday(tx, live.owner, { date: mon, name: "Festival" }));
    const b = await withTenant(live.id, (tx) => createBatch(tx, live.owner, { name: "After festival", programId: live.program, slots: MWF, startDate: today }));
    const dates = (await rows(live, b.id)).map((s) => s.sessionDate);
    expect(dates).not.toContain(mon);
    expect(dates).toContain(addDays(mon, 2));
  });

  it("close removes classes after the last day, reopen brings them back, delete removes the future; the past stays", async () => {
    const today = todayIn(IST);
    const b = await withTenant(live.id, (tx) => createBatch(tx, live.owner, { name: "Closing", programId: live.program, slots: MWF, startDate: addDays(today, -21) }));
    await withHistory(live, b.id, 14);
    const now = new Date();
    const past = (await rows(live, b.id)).filter((s) => s.startsAt <= now).map((s) => s.id);
    const full = (await rows(live, b.id)).length;

    await withTenant(live.id, (tx) => closeBatch(tx, live.owner, b.id, { endDate: addDays(today, 14) }));
    const closed = await rows(live, b.id);
    expect(closed.every((s) => s.sessionDate <= addDays(today, 14))).toBe(true);
    expect(closed.length).toBeLessThan(full);

    await withTenant(live.id, (tx) => reopenBatch(tx, live.owner, b.id));
    expect((await rows(live, b.id)).length).toBe(full);

    await withTenant(live.id, (tx) => archiveBatch(tx, live.owner, b.id));
    expect((await rows(live, b.id)).map((s) => s.id)).toEqual(past);
  });
});

describe("the nightly job", () => {
  it("one tenant failing doesn't stop the others, and is reported", async () => {
    const [good, bad] = await Promise.all([tenant("good"), tenant("bad")]);
    const [g, b] = await Promise.all([rawBatch(good, days([1, 3, 5], "18:00", "19:00"), "2026-10-01"), rawBatch(bad, days([1, 3, 5], "18:00", "19:00"), "2026-10-01")]);
    await withPlatformAdmin({ action: "test.break_timezone", actorType: "system" }, (tx) => tx.update(tenants).set({ timezone: "Mars/Olympus" }).where(eq(tenants.id, bad.id)));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await runSessionsGenerate({ now: new Date("2026-09-30T18:30:00Z"), tenantIds: [bad.id, good.id] });
    err.mockRestore();
    expect(summary).toMatchObject({ tenants: 2, ok: 1, created: 26 });
    expect(summary.failed).toEqual([expect.objectContaining({ tenantId: bad.id })]);
    expect((await rows(good, g)).length).toBe(26);
    expect((await rows(bad, b)).length).toBe(0);
  });

  it("a tenant moving timezone gets its future classes moved; past ones stay", async () => {
    const t = await tenant("move");
    const id = await rawBatch(t, days([1, 3, 5], "18:00", "19:00"), "2026-10-01");
    await reconcile(t, new Date("2026-09-30T18:30:00Z"));
    await withPlatformAdmin({ action: "test.move_timezone", actorType: "system" }, (tx) => tx.update(tenants).set({ timezone: "Asia/Dubai" }).where(eq(tenants.id, t.id)));
    const later = new Date("2026-10-10T00:00:00Z");
    await reconcile(t, later);
    const [past, future] = await Promise.all([
      withTenant(t.id, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, id), lte(sessions.startsAt, later)))),
      withTenant(t.id, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, id), gt(sessions.startsAt, later)))),
    ]);
    expect(past.length).toBeGreaterThan(0);
    expect(past.every((s) => timeIn(IST, s.startsAt) === "18:00")).toBe(true);
    expect(future.length).toBeGreaterThan(20);
    expect(future.every((s) => timeIn("Asia/Dubai", s.startsAt) === "18:00")).toBe(true);
  });

  it("200 batches × 60 days of daily classes generate in under 30 seconds", async () => {
    const t = await tenant("scale");
    for (let i = 0; i < 200; i++) await rawBatch(t, days([0, 1, 2, 3, 4, 5, 6], "06:00", "07:00"), "2026-10-01");
    const now = new Date("2026-09-30T18:30:00Z");
    const started = performance.now();
    const first = await runSessionsGenerate({ now, tenantIds: [t.id] });
    const ms = performance.now() - started;
    const again = await runSessionsGenerate({ now, tenantIds: [t.id] });
    expect(first.created).toBe(200 * 61);
    expect(again.created).toBe(0);
    expect(ms).toBeLessThan(30_000);
  }, 60_000);

  it("a queued sessions.generate job is run by a pg-boss worker through the pooler", async () => {
    const t = await tenant("boss");
    const id = await rawBatch(t, days([1, 3, 5], "18:00", "19:00"), todayIn(IST));
    const boss = createBoss();
    await boss.start();
    try {
      await workSessionsGenerate(boss);
      await boss.send(SESSIONS_GENERATE, { tenantIds: [t.id] });
      await vi.waitFor(async () => expect((await rows(t, id)).length).toBeGreaterThan(20), { timeout: 20_000, interval: 250 });
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
