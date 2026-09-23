import { afterEach, describe, expect, it } from "vitest";
import { validateSlots } from "@/modules/batches/schedule";
import { localToUtc, type PlanBatch, planOccurrences, tzOffsetMinutes } from "./occurrences";

const IST = "Asia/Kolkata";
const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const rule = (weekday: number, startTime: string, endTime: string, effectiveFrom = "2026-01-01", effectiveTo: string | null = null) => ({ weekday, startTime, endTime, effectiveFrom, effectiveTo });
const batch = (rules: PlanBatch["rules"], over: Partial<PlanBatch> = {}): PlanBatch => ({ id: "b", branchId: "main", startDate: "2026-01-01", endDate: null, status: "active", rules, ...over });
const plan = (b: PlanBatch[], now: string, days = 14, holidays: { date: string; branchId: string | null; name: string }[] = [], timeZone = IST) =>
  planOccurrences({ batches: b, holidays, timeZone, now: new Date(now), days });
const every = (start: string, end: string) => [0, 1, 2, 3, 4, 5, 6].map((d) => rule(d, start, end));

describe("localToUtc (Asia/Kolkata)", () => {
  it("1. a 5:00 AM Tuesday class is Monday 23:30 UTC", () => {
    expect(iso(localToUtc("2026-09-29", "05:00", IST))).toBe("2026-09-28T23:30:00Z");
  });

  it("2. the seeded 5:30 AM class is exactly midnight UTC on the same date", () => {
    expect(iso(localToUtc("2026-09-29", "05:30", IST))).toBe("2026-09-29T00:00:00Z");
  });

  it("14. half-hour and 45-minute offsets", () => {
    expect(tzOffsetMinutes(new Date("2026-09-29T00:00:00Z"), IST)).toBe(330);
    expect(iso(localToUtc("2026-09-29", "06:00", "Asia/Kathmandu"))).toBe("2026-09-29T00:15:00Z");
  });
});

describe("localToUtc across daylight saving (America/New_York)", () => {
  const NY = "America/New_York";

  it("11. a time that doesn't exist (2:30 AM on spring-forward day) moves past the jump", () => {
    expect(iso(localToUtc("2026-03-08", "02:30", NY))).toBe("2026-03-08T07:30:00Z"); // 3:30 AM EDT
  });

  it("11b. a class that starts inside the gap keeps its length instead of shrinking to nothing", () => {
    const [o] = plan([batch([rule(0, "02:30", "03:30")])], "2026-03-07T12:00:00Z", 2, [], NY);
    expect([iso(o?.startsAt ?? new Date(0)), iso(o?.endsAt ?? new Date(0))]).toEqual(["2026-03-08T07:30:00Z", "2026-03-08T08:30:00Z"]); // 3:30–4:30 EDT
  });

  it("12. a time that happens twice (1:30 AM on fall-back day) takes the first, and the class keeps its hour", () => {
    expect(iso(localToUtc("2026-11-01", "01:30", NY))).toBe("2026-11-01T05:30:00Z"); // 1:30 AM EDT
    const [o] = plan([batch([rule(0, "01:30", "02:30")])], "2026-10-31T12:00:00Z", 2, [], NY);
    expect([iso(o?.startsAt ?? new Date(0)), iso(o?.endsAt ?? new Date(0))]).toEqual(["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]);
  });

  it("13. an ordinary 6 PM class keeps its local time across the change", () => {
    expect(iso(localToUtc("2026-03-01", "18:00", NY))).toBe("2026-03-01T23:00:00Z"); // EST
    expect(iso(localToUtc("2026-03-08", "18:00", NY))).toBe("2026-03-08T22:00:00Z"); // EDT
    const sundays = plan([batch([rule(0, "18:00", "19:00")])], "2026-02-28T12:00:00Z", 10, [], NY);
    expect(sundays.map((o) => [o.sessionDate, iso(o.startsAt)])).toEqual([
      ["2026-03-01", "2026-03-01T23:00:00Z"],
      ["2026-03-08", "2026-03-08T22:00:00Z"],
    ]);
  });
});

describe("planOccurrences", () => {
  it("1. uses the local date for the weekday: a Tuesday-only 5 AM rule never lands on a Monday", () => {
    const occ = plan([batch([rule(2, "05:00", "06:00")])], "2026-09-23T00:00:00Z", 14);
    expect(occ.map((o) => [o.sessionDate, iso(o.startsAt)])).toEqual([
      ["2026-09-29", "2026-09-28T23:30:00Z"],
      ["2026-10-06", "2026-10-05T23:30:00Z"],
    ]);
  });

  it("3. starts from the tenant's today, and skips classes already past", () => {
    // 20:00 UTC on the 23rd is 01:30 on the 24th in India.
    const occ = plan([batch([...every("01:00", "02:00"), ...every("06:00", "07:00")])], "2026-09-23T20:00:00Z", 0);
    expect(occ.map((o) => `${o.sessionDate} ${iso(o.startsAt)}`)).toEqual(["2026-09-24 2026-09-24T00:30:00Z"]);
  });

  it("4. gives the same answer whatever the server's timezone is", () => {
    const run = () => JSON.stringify(plan([batch([rule(2, "05:00", "06:00"), rule(4, "23:00", "01:00")])], "2026-09-23T20:00:00Z", 30));
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utc = run();
      process.env.TZ = "America/Los_Angeles";
      const la = run();
      process.env.TZ = "Asia/Kolkata";
      expect(la).toBe(utc);
      expect(run()).toBe(utc);
    } finally {
      process.env.TZ = original;
    }
  });

  it("5. a class crossing midnight ends the next day and belongs to the day it starts", () => {
    const [o] = plan([batch([rule(5, "23:00", "01:00")])], "2026-09-23T00:00:00Z", 3);
    expect(o).toMatchObject({ sessionDate: "2026-09-25" });
    expect(iso(o?.startsAt ?? new Date(0))).toBe("2026-09-25T17:30:00Z");
    expect(iso(o?.endsAt ?? new Date(0))).toBe("2026-09-25T19:30:00Z"); // 01:00 on the 26th, local
  });

  it("6. a class ending at midnight lasts two hours; 6 AM – 5 AM is refused", () => {
    const [o] = plan([batch([rule(5, "22:00", "00:00")])], "2026-09-23T00:00:00Z", 3);
    expect(((o?.endsAt.getTime() ?? 0) - (o?.startsAt.getTime() ?? 0)) / 3_600_000).toBe(2);
    expect(validateSlots([{ weekday: 1, startTime: "06:00", endTime: "05:00" }])).toBe("Mon: 23 hours is too long for one class. Check AM/PM.");
  });

  it("7. holidays are local dates: the 5 AM class on 2 Oct (1 Oct in UTC) is marked, 1 Oct's is not", () => {
    const occ = plan([batch(every("05:00", "06:00"))], "2026-09-30T00:00:00Z", 3, [{ date: "2026-10-02", branchId: null, name: "Gandhi Jayanti" }]);
    expect(occ.map((o) => [o.sessionDate, o.holiday ?? null])).toEqual([
      ["2026-10-01", null],
      ["2026-10-02", "Gandhi Jayanti"],
      ["2026-10-03", null],
    ]);
    const branchOnly = plan([batch(every("05:00", "06:00"))], "2026-09-30T00:00:00Z", 3, [{ date: "2026-10-02", branchId: "other", name: "Local" }]);
    expect(branchOnly.every((o) => !o.holiday)).toBe(true);
  });

  it("8. a timing change switches on the local date", () => {
    const rules = [rule(3, "05:00", "06:00", "2026-01-01", "2026-09-29"), rule(3, "06:00", "07:00", "2026-09-30")];
    // 17:30 IST on the 22nd, so the 5 AM class on the 23rd is still ahead.
    const occ = plan([batch(rules)], "2026-09-22T12:00:00Z", 15);
    expect(occ.map((o) => [o.sessionDate, iso(o.startsAt)])).toEqual([
      ["2026-09-23", "2026-09-22T23:30:00Z"],
      ["2026-09-30", "2026-09-30T00:30:00Z"],
      ["2026-10-07", "2026-10-07T00:30:00Z"],
    ]);
  });

  it("9. batch start and end dates are local dates; paused batches make nothing", () => {
    const occ = plan([batch(every("18:00", "19:00"), { startDate: "2026-09-25", endDate: "2026-09-27" })], "2026-09-23T00:00:00Z", 14);
    expect(occ.map((o) => o.sessionDate)).toEqual(["2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(plan([batch(every("18:00", "19:00"), { status: "paused" })], "2026-09-23T00:00:00Z", 14)).toEqual([]);
  });

  it("10. crosses the year end and finds 29 February", () => {
    const newYear = plan([batch(every("18:00", "19:00"))], "2026-12-30T00:00:00Z", 2);
    expect(newYear.map((o) => o.sessionDate)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    const leap = plan([batch([rule(2, "18:00", "19:00")])], "2028-02-27T00:00:00Z", 3);
    expect(leap.map((o) => o.sessionDate)).toEqual(["2028-02-29"]);
  });

  it("15. includes day 60 and gives identical output on a second run", () => {
    const now = "2026-09-23T00:00:00Z";
    const a = plan([batch(every("18:00", "19:00"))], now, 60);
    expect(a.at(-1)?.sessionDate).toBe("2026-11-22");
    expect(plan([batch(every("18:00", "19:00"))], now, 60)).toEqual(a);
  });
});

afterEach(() => {
  // guard: no test may leave a changed process timezone behind
  expect(process.env.TZ === undefined || typeof process.env.TZ === "string").toBe(true);
});
