import { describe, expect, it } from "vitest";
import { attendancePercent } from "@/modules/attendance/percent";
import { type ClassMark, monthCells, monthTrend, tallyOf, tallyPct } from "./attendance";

describe("one attendance rule", () => {
  const marks = { present: 3, late: 1, absent: 2 };
  it("the listing, the month trend and attendancePercent agree on the same marks", () => {
    const classes: ClassMark[] = [...Array(3).fill("present"), "late", ...Array(2).fill("absent"), "excused", null].map((mark) => ({ date: "2026-10-05", mark }));
    expect(attendancePercent(marks)).toBe(67);
    expect(monthTrend(classes, "2026-10", 1)[0]?.pct).toBe(attendancePercent(marks));
    expect(tallyPct(tallyOf(classes))).toBe(attendancePercent(marks));
  });
  it("is null with nothing counted, never 0", () => {
    expect(attendancePercent({ present: 0, late: 0, absent: 0 })).toBeNull();
  });
});

describe("monthTrend", () => {
  const classes: ClassMark[] = [
    { date: "2026-10-02", mark: "present" },
    { date: "2026-10-05", mark: "absent" },
    { date: "2026-10-07", mark: "late" },
    { date: "2026-09-04", mark: null },
    { date: "2026-09-08", mark: null },
    { date: "2026-07-03", mark: "excused" },
  ];
  const trend = monthTrend(classes, "2026-10", 6);

  it("runs oldest first, ending on the given month", () => {
    expect(trend.map((m) => m.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });
  it("counts late as attended and a real rate", () => {
    expect(trend[5]).toMatchObject({ classes: 3, pct: 67 });
  });
  it("a month with no classes is null with zero classes, never 0%", () => {
    expect(trend[3]).toMatchObject({ classes: 0, pct: null });
  });
  it("a month where nothing was marked is null but has classes; unmarked is not absent", () => {
    expect(trend[4]).toMatchObject({ classes: 2, pct: null, tally: { unmarked: 2, absent: 0 } });
  });
  it("excused sits on neither side", () => {
    expect(trend[2]).toMatchObject({ classes: 1, pct: null, tally: { excused: 1 } });
  });
});

describe("monthCells", () => {
  const hols = [{ date: "2026-10-02", name: "Gandhi Jayanti" }];
  it("a holiday with no class is a holiday, not an absence", () => {
    const cells = monthCells("2026-10", "2026-10-31", [], hols);
    expect(cells).toHaveLength(31);
    expect(cells[1]).toMatchObject({ day: 2, state: "holiday", holiday: "Gandhi Jayanti" });
    expect(cells.filter((c) => c.state === "absent")).toHaveLength(0);
    expect(cells[2]?.state).toBe("none");
  });
  it("a class on a holiday date keeps its mark", () => {
    expect(monthCells("2026-10", "2026-10-31", [{ date: "2026-10-02", mark: "present" }], hols)[1]?.state).toBe("present");
  });
  it("two classes in a day show the worst mark; unmarked stays unmarked", () => {
    const two: ClassMark[] = [{ date: "2026-10-05", mark: "present" }, { date: "2026-10-05", mark: "absent" }, { date: "2026-10-07", mark: null }];
    const cells = monthCells("2026-10", "2026-10-31", two, []);
    expect(cells[4]?.state).toBe("absent");
    expect(cells[6]?.state).toBe("unmarked");
  });
});
