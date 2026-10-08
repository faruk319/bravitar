import type { ReactNode } from "react";
import { Columns } from "@/components/reports/bars";
import { Card } from "@/components/ui/card";
import { formatMonthYear } from "@/lib/dates";
import type { StudentTrends } from "@/modules/students/trends";

const tick = (month: string) => formatMonthYear(`${month}-01`).split(" ")[0] ?? month;
const long = (month: string) => formatMonthYear(`${month}-01`);

function Frame({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card className="gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-label text-neutral-700">{title}</h2>
        {aside ? <span className="text-caption text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </Card>
  );
}

// Plain classes: cn() would read the custom text-display size as a colour and drop it.
const Big = ({ children }: { children: ReactNode }) => <span className="text-display tabular-nums text-neutral-900">{children}</span>;

function Enrolment({ data }: { data: StudentTrends["enrolment"] }) {
  const active = data.months.filter((m) => m.joined || m.left);
  const max = Math.max(1, ...data.months.flatMap((m) => [m.joined, m.left]));
  const net = data.net > 0 ? `+${data.net}` : data.net < 0 ? `−${-data.net}` : "0";
  const n = data.months.length;
  return (
    <Frame title="Joined and left" aside="Last 12 months">
      {active.length === 0 ? (
        <p className="py-10 text-center text-body text-muted-foreground">No joiners or leavers yet</p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-body">
            <span>
              <Big>{net}</Big> <span className="text-caption text-muted-foreground">net</span>
            </span>
            <span className="tabular-nums">{data.joined} joined</span>
            <span className="tabular-nums">{data.left} left</span>
          </p>
          {active.length === 1 ? null : (
            <figure aria-label="Joined and left, by month">
              <div className="flex h-32 items-end gap-1 border-b border-neutral-100 pt-4">
                {data.months.map((m) => (
                  <span key={m.month} title={`${long(m.month)}: ${m.joined} joined, ${m.left} left`} aria-label={`${long(m.month)}: ${m.joined} joined, ${m.left} left`} className="flex h-full min-w-0 flex-1 items-end justify-center gap-px">
                    <span className="block w-full max-w-3 rounded-t-[3px] bg-accent-600" style={{ height: `${(m.joined / max) * 100}%` }} />
                    <span className="block w-full max-w-3 rounded-t-[3px] bg-neutral-500" style={{ height: `${(m.left / max) * 100}%` }} />
                  </span>
                ))}
              </div>
              <div className="flex gap-1 text-caption tabular-nums text-muted-foreground">
                {data.months.map((m, i) => (
                  <span key={m.month} className="min-w-0 flex-1 text-center">
                    {i % 3 === (n - 1) % 3 ? tick(m.month) : ""}
                  </span>
                ))}
              </div>
              <figcaption className="mt-1 flex gap-4 text-caption text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-accent-600" aria-hidden /> Joined
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-neutral-500" aria-hidden /> Left
                </span>
              </figcaption>
            </figure>
          )}
        </>
      )}
    </Frame>
  );
}

function Attendance({ data }: { data: NonNullable<StudentTrends["attendance"]> }) {
  const held = data.months.filter((m) => m.percent !== null);
  return (
    <Frame title="Attendance" aside="Last 6 months">
      {held.length === 0 ? (
        <p className="py-10 text-center text-body text-muted-foreground">No classes</p>
      ) : held.length === 1 ? (
        <p className="py-6">
          <Big>{held[0]?.percent}%</Big> <span className="text-caption text-muted-foreground">in {long(held[0]?.month ?? "")}</span>
        </p>
      ) : (
        <>
          <p>
            <Big>{data.percent}%</Big> <span className="text-caption text-muted-foreground">overall</span>
          </p>
          <Columns
            label="Attendance by month"
            columns={data.months.map((m) => ({
              key: m.month,
              tick: tick(m.month),
              tip: m.percent === null ? `${long(m.month)}: No classes` : `${long(m.month)}: ${m.percent}%`,
              value: m.percent ?? 0,
              ...(m.percent === null ? { empty: true } : {}),
              valueText: `${m.percent ?? 0}%`,
            }))}
          />
        </>
      )}
    </Frame>
  );
}

// The KPI block sits in the left corner with the two charts beside it, one row.
export function TrendCards({ trends, lead }: { trends: StudentTrends; lead?: ReactNode }) {
  return (
    <div className="mb-5 grid gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.05fr)]">
      {lead}
      <Enrolment data={trends.enrolment} />
      {trends.attendance ? <Attendance data={trends.attendance} /> : null}
    </div>
  );
}
