"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatPaise } from "@/lib/money/format";

type Month = { month: string; totalPaise: bigint };
type Datum = { tick: string; rupees: number; paise: bigint };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// From the YYYY-MM string; no Date, so no timezone shift.
const tick = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;

export function RevenueOverview({ months, collected, pending, overdue }: { months: Month[]; collected: bigint; pending: bigint; overdue: bigint }) {
  // bigint becomes number only here, in rupees, for the bar scale; exact paise ride along for the tooltip.
  const data: Datum[] = months.map((m) => ({ tick: tick(m.month), rupees: Number(m.totalPaise / 100n), paise: m.totalPaise }));
  // Only the peak month is labelled; the rest show theirs in the tooltip.
  const peak = data.reduce((best, d, i) => (d.rupees > (data[best]?.rupees ?? -1) ? i : best), 0);
  const peakPaise = data[peak]?.paise ?? 0n;
  const figures = [
    { label: "Collected", value: collected },
    { label: "Pending", value: pending },
    { label: "Overdue", value: overdue },
  ];
  return (
    <div>
      {data.length ? (
        <figure
          aria-label={`Collection by month: ${months.map((m) => `${tick(m.month)} ${formatPaise(m.totalPaise)}`).join(", ")}`}
          className="h-44"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
              <XAxis dataKey="tick" tickLine={false} axisLine={false} tick={{ fontSize: 13, fill: "var(--color-neutral-500)" }} />
              <Tooltip
                cursor={false}
                isAnimationActive={false}
                formatter={(_value, _name, item) => [formatPaise((item.payload as Datum).paise), "Collected"]}
                contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "none", fontSize: 13 }}
              />
              <Bar dataKey="rupees" fill="var(--color-accent-600)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList
                  dataKey="rupees"
                  content={({ x, y, width, index }) =>
                    index === peak && peakPaise > 0n ? (
                      <text x={Number(x) + Number(width) / 2} y={Number(y) - 6} textAnchor="middle" fontSize={13} fill="var(--color-neutral-500)">
                        {formatPaise(peakPaise)}
                      </text>
                    ) : null
                  }
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </figure>
      ) : (
        <p className="text-body text-muted-foreground">No collection yet.</p>
      )}
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {figures.map((f) => (
          <div key={f.label}>
            <dt className="text-caption text-muted-foreground">{f.label}</dt>
            <dd className="text-number text-neutral-900">{formatPaise(f.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
