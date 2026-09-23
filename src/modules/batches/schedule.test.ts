import { describe, expect, it } from "vitest";
import { formatTime, formatTimeRange, normalizeTime, type Rule, rulesOn, summarizeSchedule, validateSlots, weekGrid } from "./schedule";

const mwf = (start: string, end: string, from = "2026-09-01", to: string | null = null): Rule[] =>
  [1, 3, 5].map((weekday) => ({ weekday, startTime: start, endTime: end, effectiveFrom: from, effectiveTo: to }));

describe("times", () => {
  it("normalises and formats like the wireframes", () => {
    expect(normalizeTime("18:00:00")).toBe("18:00");
    expect(normalizeTime("6:05")).toBe("06:05");
    expect(normalizeTime("24:00")).toBeUndefined();
    expect(formatTime("18:00")).toBe("6:00 PM");
    expect(formatTime("00:00")).toBe("12:00 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTimeRange("18:00", "19:00")).toBe("6:00 – 7:00 PM");
    expect(formatTimeRange("05:30:00", "06:30:00")).toBe("5:30 – 6:30 AM");
    expect(formatTimeRange("11:30", "12:30")).toBe("11:30 AM – 12:30 PM");
  });

  it("validates a weekly timing", () => {
    expect(validateSlots([])).toBe("Pick at least one day");
    expect(validateSlots([{ weekday: 1, startTime: "18:00", endTime: "19:00" }, { weekday: 1, startTime: "07:00", endTime: "08:00" }])).toBe("Mon is listed twice");
    expect(validateSlots([{ weekday: 3, startTime: "19:00", endTime: "18:00" }])).toBe("Wed: end time must be after start time");
    expect(validateSlots([{ weekday: 0, startTime: "", endTime: "10:00" }])).toBe("Sun: enter a start and end time");
    expect(validateSlots([{ weekday: 7, startTime: "10:00", endTime: "11:00" }])).toBe("Unknown day");
    expect(validateSlots(mwf("18:00", "19:00"))).toBeUndefined();
  });

  it("summarises Monday first, grouping days that share a time", () => {
    expect(summarizeSchedule(mwf("18:00", "19:00"))).toBe("Mon · Wed · Fri 6:00 – 7:00 PM");
    expect(
      summarizeSchedule([
        { weekday: 6, startTime: "10:00", endTime: "11:30" },
        { weekday: 1, startTime: "16:00", endTime: "17:00" },
        { weekday: 3, startTime: "16:00", endTime: "17:00" },
        { weekday: 0, startTime: "08:00", endTime: "09:00" },
      ]),
    ).toBe("Mon · Wed 4:00 – 5:00 PM, Sat 10:00 – 11:30 AM, Sun 8:00 – 9:00 AM");
    expect(summarizeSchedule([])).toBe("No timing");
  });
});

describe("rulesOn", () => {
  it("picks the version in force on each date", () => {
    const rules = [...mwf("18:00", "19:00", "2026-09-01", "2026-09-22"), ...mwf("19:00", "20:00", "2026-09-23")];
    expect(rulesOn(rules, "2026-09-22").map((r) => r.startTime)).toEqual(["18:00", "18:00", "18:00"]);
    expect(rulesOn(rules, "2026-09-23").map((r) => r.startTime)).toEqual(["19:00", "19:00", "19:00"]);
    expect(rulesOn(rules, "2026-08-31")).toEqual([]);
  });
});

describe("weekGrid", () => {
  const week = "2026-09-21"; // Monday

  it("shows a Mon/Wed/Fri 6–7 PM batch on exactly those days", () => {
    const grid = weekGrid([{ key: "b", branchId: "x", rules: mwf("18:00", "19:00"), startDate: "2026-09-01", endDate: null }], week, []);
    expect(grid.map((d) => [d.date, d.blocks.map((b) => `${b.startTime}-${b.endTime}`)])).toEqual([
      ["2026-09-21", ["18:00-19:00"]],
      ["2026-09-22", []],
      ["2026-09-23", ["18:00-19:00"]],
      ["2026-09-24", []],
      ["2026-09-25", ["18:00-19:00"]],
      ["2026-09-26", []],
      ["2026-09-27", []],
    ]);
  });

  it("uses the old timing before a change and the new one after, mid-week", () => {
    const rules = [...mwf("18:00", "19:00", "2026-09-01", "2026-09-22"), ...mwf("19:00", "20:00", "2026-09-23")];
    const grid = weekGrid([{ key: "b", branchId: "x", rules, startDate: "2026-09-01", endDate: null }], week, []);
    expect([grid[0], grid[2], grid[4]].map((d) => d?.blocks[0]?.startTime)).toEqual(["18:00", "19:00", "19:00"]);
  });

  it("respects the batch's start and end dates", () => {
    const grid = weekGrid([{ key: "b", branchId: "x", rules: mwf("18:00", "19:00"), startDate: "2026-09-23", endDate: "2026-09-24" }], week, []);
    expect(grid.map((d) => d.blocks.length)).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });

  it("marks holidays for all branches, and branch holidays only for that branch", () => {
    const items = [
      { key: "a", branchId: "main", rules: mwf("18:00", "19:00"), startDate: "2026-09-01", endDate: null },
      { key: "k", branchId: "kothrud", rules: mwf("07:00", "08:00"), startDate: "2026-09-01", endDate: null },
    ];
    const grid = weekGrid(items, "2026-09-28", [
      { date: "2026-10-02", name: "Gandhi Jayanti", branchId: null },
      { date: "2026-09-30", name: "Local festival", branchId: "kothrud" },
    ]);
    const fri = grid[4];
    expect(fri?.holidays).toEqual(["Gandhi Jayanti"]);
    expect(fri?.blocks.map((b) => [b.key, b.holiday])).toEqual([["k", "Gandhi Jayanti"], ["a", "Gandhi Jayanti"]]);
    const wed = grid[2];
    expect(wed?.blocks.map((b) => [b.key, b.holiday ?? null])).toEqual([["k", "Local festival"], ["a", null]]);
  });
});
