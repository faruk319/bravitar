import { BarList } from "@/components/reports/bars";
import { MARK_STYLE } from "@/components/attendance/mark-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { formatMonthYear } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { StudentProfile } from "@/modules/students/profile";

const TILES = ["present", "absent", "late", "unmarked"] as const;

// Last 30 days, the same window and rule as the listing; then a row per month.
export function AttendanceSummaryCard({ attendance }: { attendance: NonNullable<StudentProfile["attendance"]> }) {
  const { summary, trend } = attendance;
  return (
    <Card>
      <CardHeader title="Attendance" action={<span className="text-display tabular-nums">{summary.percent === null ? "No classes" : `${summary.percent}%`}</span>} />
      <p className="mb-2 text-caption text-muted-foreground">Last 30 days</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        {TILES.map((k) => (
          <div key={k} className={cn("rounded-xl px-3 py-2", k === "unmarked" ? "bg-neutral-100 text-neutral-700" : MARK_STYLE[k].cls)}>
            <p className="text-label">
              <span aria-hidden>{k === "unmarked" ? "○" : MARK_STYLE[k].icon}</span> {k === "unmarked" ? "Not marked" : MARK_STYLE[k].word}
            </p>
            <p className="text-display tabular-nums">{summary.counts[k]}</p>
          </div>
        ))}
      </div>
      <p className="mb-1 mt-4 text-caption text-muted-foreground">By month</p>
      <BarList
        items={trend.map((m) => ({
          key: m.month,
          label: formatMonthYear(`${m.month}-01`),
          value: m.classes === 0 ? "No classes" : m.pct === null ? "Not marked" : `${m.pct}%`,
          fraction: (m.pct ?? 0) / 100,
        }))}
      />
    </Card>
  );
}
