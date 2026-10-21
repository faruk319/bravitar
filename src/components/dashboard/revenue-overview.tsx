"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatPaise } from "@/lib/money/format";

type Point = { label: string; totalPaise: bigint };
type Datum = { tick: string; rupees: number; paise: bigint };

// One bar per month (dashboard) or per day (finance overview); `label` names the chart for screen readers.
export function RevenueOverview({ bars, label }: { bars: Point[]; label: string }) {
  // bigint becomes number only here, in rupees, for the bar scale; exact paise ride along for the tooltip.
  const data: Datum[] = bars.map((b) => ({ tick: b.label, rupees: Number(b.totalPaise / 100n), paise: b.totalPaise }));
  // Only the peak month is labelled; the rest show theirs in the tooltip.
  const peak = data.reduce((best, d, i) => (d.rupees > (data[best]?.rupees ?? -1) ? i : best), 0);
  const peakPaise = data[peak]?.paise ?? 0n;
  return (
    <div>
      {data.length ? (
        <figure
          aria-label={`${label}: ${bars.map((b) => `${b.label} ${formatPaise(b.totalPaise)}`).join(", ")}`}
          className="h-44"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
              <XAxis dataKey="tick" interval="preserveStartEnd" minTickGap={16} tickLine={false} axisLine={false} tick={{ fontSize: 13, fill: "var(--color-neutral-500)" }} />
              <Tooltip
                cursor={false}
                isAnimationActive={false}
                formatter={(_value, _name, item) => [formatPaise((item.payload as Datum).paise), "Collected"]}
                contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "none", fontSize: 13 }}
              />
              <Bar dataKey="rupees" fill="var(--color-accent-600)" maxBarSize={48} radius={[4, 4, 0, 0]} isAnimationActive={false}>
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
    </div>
  );
}
