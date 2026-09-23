"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { minutes, type Slot, WEEK_ORDER, WEEKDAY_SHORT } from "@/modules/batches/schedule";

export type ScheduleValue = { days: number[]; perDay: boolean; start: string; end: string; times: Record<number, { start: string; end: string }> };

export const emptySchedule: ScheduleValue = { days: [], perDay: false, start: "", end: "", times: {} };

export function toSlots(v: ScheduleValue): Slot[] {
  return WEEK_ORDER.filter((d) => v.days.includes(d)).map((d) => {
    const t = v.perDay ? (v.times[d] ?? { start: v.start, end: v.end }) : { start: v.start, end: v.end };
    return { weekday: d, startTime: t.start, endTime: t.end };
  });
}

export function fromSlots(slots: Slot[]): ScheduleValue {
  const first = slots[0];
  const same = slots.every((s) => s.startTime === first?.startTime && s.endTime === first?.endTime);
  return {
    days: slots.map((s) => s.weekday),
    perDay: !same,
    start: first?.startTime ?? "",
    end: first?.endTime ?? "",
    times: Object.fromEntries(slots.map((s) => [s.weekday, { start: s.startTime, end: s.endTime }])),
  };
}

// An hour later, which is what most classes are; blank past midnight.
function plusHour(t: string): string {
  const m = minutes(t) + 60;
  return m >= 24 * 60 ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function withStart(pair: { start: string; end: string }, start: string) {
  return { start, end: !pair.end || minutes(pair.end) <= minutes(start) ? plusHour(start) : pair.end };
}

export function ScheduleEditor({ value, onChange }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void }) {
  const toggleDay = (d: number) => onChange({ ...value, days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d] });
  const setPerDay = (perDay: boolean) =>
    onChange({ ...value, perDay, times: perDay ? Object.fromEntries(value.days.map((d) => [d, value.times[d] ?? { start: value.start, end: value.end }])) : value.times });
  const setDay = (d: number, pair: { start: string; end: string }) => onChange({ ...value, times: { ...value.times, [d]: pair } });

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-label">Days</legend>
      <div className="grid grid-cols-7 gap-1">
        {WEEK_ORDER.map((d) => {
          const on = value.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => toggleDay(d)}
              className={cn("h-12 w-full rounded-lg border text-body", on ? "border-accent-600 bg-accent-50 font-medium text-accent-600" : "border-border bg-background text-neutral-700")}
            >
              {WEEKDAY_SHORT[d]}
            </button>
          );
        })}
      </div>

      {value.perDay ? (
        <div className="flex flex-col gap-2">
          {WEEK_ORDER.filter((d) => value.days.includes(d)).map((d) => {
            const pair = value.times[d] ?? { start: value.start, end: value.end };
            return (
              <div key={d} className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
                <span className="text-body font-medium">{WEEKDAY_SHORT[d]}</span>
                <Input type="time" step={300} aria-label={`${WEEKDAY_SHORT[d]} starts`} value={pair.start} onChange={(e) => setDay(d, withStart(pair, e.target.value))} />
                <Input type="time" step={300} aria-label={`${WEEKDAY_SHORT[d]} ends`} value={pair.end} onChange={(e) => setDay(d, { ...pair, end: e.target.value })} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="starts">Starts</Label>
            <Input id="starts" type="time" step={300} value={value.start} onChange={(e) => onChange({ ...value, ...withStart(value, e.target.value) })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ends">Ends</Label>
            <Input id="ends" type="time" step={300} value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />
          </div>
        </div>
      )}

      <label className="flex min-h-12 items-center gap-3 text-body">
        <input type="checkbox" checked={value.perDay} onChange={(e) => setPerDay(e.target.checked)} className="size-5" />
        Different times per day
      </label>
    </fieldset>
  );
}
