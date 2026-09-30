import { describe, expect, it } from "vitest";
import { addDays, formatDate, isIsoDate, nextMonthOn, startOfWeek, todayIn, weekdayOf } from "./dates";

describe("calendar dates", () => {
  it("knows what day it is in the tenant's timezone, not the server's", () => {
    const lateUtc = new Date("2026-09-23T20:00:00Z"); // 01:30 on the 24th in India
    expect(todayIn("Asia/Kolkata", lateUtc)).toBe("2026-09-24");
    expect(todayIn("UTC", lateUtc)).toBe("2026-09-23");
    expect(todayIn("America/New_York", lateUtc)).toBe("2026-09-23");
  });

  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST starts
  });

  it("finds next month's bill date, on the month's last day when it's shorter", () => {
    expect(nextMonthOn("2026-09-30", 30)).toBe("2026-10-30");
    expect(nextMonthOn("2026-01-31", 31)).toBe("2026-02-28");
    expect(nextMonthOn("2026-02-28", 31)).toBe("2026-03-31");
    expect(nextMonthOn("2028-01-30", 30)).toBe("2028-02-29"); // leap year
    expect(nextMonthOn("2026-12-15", 15)).toBe("2027-01-15");
  });

  it("weekdays and Monday-start weeks", () => {
    expect(weekdayOf("2026-09-23")).toBe(3); // Wednesday
    expect(startOfWeek("2026-09-23")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21"); // Sunday belongs to the week before
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("validates ISO dates and formats them for display", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("23/09/2026")).toBe(false);
    expect(formatDate("2026-10-02")).toBe("2 Oct 2026");
  });
});
