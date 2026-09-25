import { describe, expect, it } from "vitest";
import { dayStart, feeStage, hourFor, sendTime, tomorrowAt } from "./schedule";

const IST = "Asia/Kolkata";
const at = (s: string) => new Date(s);
const iso = (d: Date) => d.toISOString().replace(".000", "");

describe("feeStage (agreed 2026-09-25: 3 days before, 1 and 7 days after)", () => {
  it("names the stage for each day around a due date, with days to catch up", () => {
    const due = "2026-10-10";
    const on = (today: string) => {
      const s = feeStage(due, today);
      return s ? `${s.key}/${s.stage}` : "none";
    };
    expect(["2026-10-06", "2026-10-07", "2026-10-10", "2026-10-11", "2026-10-16", "2026-10-17", "2026-10-23", "2026-10-24"].map(on)).toEqual([
      "none",
      "fee_due/due",
      "fee_due/due",
      "fee_overdue/1",
      "fee_overdue/1",
      "fee_overdue/7",
      "fee_overdue/7",
      "none",
    ]);
  });

  it("counts days across a year end", () => {
    expect(feeStage("2026-12-30", "2027-01-06")).toEqual({ key: "fee_overdue", stage: "7" });
    expect(feeStage("2027-01-02", "2026-12-30")).toEqual({ key: "fee_due", stage: "due" });
  });
});

describe("sendTime: the academy's hour, never 21:00 to 07:00", () => {
  it("waits for the hour, goes at once inside the window, and moves the quiet hours to tomorrow", () => {
    expect(iso(sendTime(at("2026-10-05T02:30:00Z"), IST, 10))).toBe("2026-10-05T04:30:00Z"); // 08:00 IST -> 10:00
    expect(iso(sendTime(at("2026-10-05T05:00:00Z"), IST, 10))).toBe("2026-10-05T05:00:00Z"); // 10:30 IST: now
    expect(iso(sendTime(at("2026-10-05T16:00:00Z"), IST, 10))).toBe("2026-10-06T04:30:00Z"); // 21:30 IST -> tomorrow 10:00
    expect(iso(sendTime(at("2026-10-04T23:00:00Z"), IST, 7))).toBe("2026-10-05T01:30:00Z"); // 04:30 IST -> 07:00
    expect(iso(sendTime(at("2026-10-05T18:29:00Z"), IST, 7))).toBe("2026-10-06T01:30:00Z"); // 23:59 IST -> 07:00
  });

  it("the academy's day, not UTC's, and its next day", () => {
    expect(iso(dayStart(at("2026-10-04T18:40:00Z"), IST))).toBe("2026-10-04T18:30:00Z"); // 00:10 IST on 5 Oct
    expect(iso(tomorrowAt(at("2026-10-04T18:40:00Z"), IST, 19))).toBe("2026-10-06T13:30:00Z");
  });

  it("fees at the send hour, absences at the evening hour, receipts from 07:00", () => {
    const t = { messageSendHour: 10, absenceSendHour: 19 };
    expect([hourFor("fees", t), hourFor("attendance", t), hourFor("receipts", t)]).toEqual([10, 19, 7]);
  });
});
