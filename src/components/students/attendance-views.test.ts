import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AttendanceCalendar as Calendar } from "@/modules/attendance/service";
import type { StudentProfile } from "@/modules/students/profile";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, ...p }: { children: React.ReactNode; href: string; "aria-label"?: string }) => h("a", p, children) };
});

const { AttendanceCalendar } = await import("./attendance-calendar");
const { AttendanceSummaryCard } = await import("./attendance-summary");
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

const cell = (day: number, state: Calendar["cells"][number]["state"], holiday?: string): Calendar["cells"][number] => ({ date: `2026-10-${String(day).padStart(2, "0")}`, day, state, ...(holiday ? { holiday } : {}) });
const tally = { present: 1, late: 0, absent: 0, excused: 0, unmarked: 0 };

describe("attendance calendar", () => {
  const calendar: Calendar = { month: "2026-10", today: "2026-10-20", tally, cells: [cell(1, "present"), cell(2, "holiday", "Gandhi Jayanti"), cell(3, "absent"), cell(4, "none")] };
  const out = html(createElement(AttendanceCalendar, { calendar, href: (m: string) => `?month=${m}` }));

  it("renders a holiday as a holiday, not an absence", () => {
    expect(out).toContain("2 Oct 2026, Gandhi Jayanti");
    expect(out).toContain("3 Oct 2026, Absent");
    expect(out).not.toContain("2 Oct 2026, Absent");
  });
  it("carries a legend and a summary, and cells at least 44px", () => {
    for (const w of ["Present", "Late", "Absent", "Holiday", "No class"]) expect(out).toContain(w);
    expect(out).toContain("min-h-11");
  });
  it("offers no next month past the current one", () => {
    expect(out).toContain("Previous month");
    expect(out).not.toContain("Next month");
  });
});

describe("attendance summary", () => {
  const month = (m: string, classes: number, pct: number | null) => ({ month: m, classes, pct, tally: { ...tally } });
  const base = { from: "2026-09-21", to: "2026-10-20", counts: { present: 0, absent: 0, late: 0, excused: 0, unmarked: 3 }, percent: null, recent: [] };
  const out = html(createElement(AttendanceSummaryCard, { attendance: { summary: base, trend: [month("2026-08", 0, null), month("2026-09", 2, null), month("2026-10", 3, 80)] } as NonNullable<StudentProfile["attendance"]> }));

  it("no classes reads No classes, nothing marked reads Not marked, neither reads 0%", () => {
    expect(out).toContain("No classes");
    expect(out).toContain("Not marked");
    expect(out).toContain("80%");
    expect(out.replace(/<[^>]*>/g, " ")).not.toMatch(/(^|\D)0%/); // visible text only
  });
});
