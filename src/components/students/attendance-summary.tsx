import { BarList } from "@/components/reports/bars";
import { Card, CardHeader } from "@/components/ui/card";
import { formatMonthYear } from "@/lib/dates";
import type { StudentProfile } from "@/modules/students/profile";

// Last 30 days, the same window and rule as the listing; then a row per month. The counts are the calendar tiles.
export function AttendanceSummaryCard({ attendance }: { attendance: NonNullable<StudentProfile["attendance"]> }) {
  const { summary, trend } = attendance;
  return (
    <Card>
      <CardHeader title="Attendance" action={<span className="text-display tabular-nums">{summary.percent === null ? "No classes" : `${summary.percent}%`}</span>} />
      <p className="mb-2 text-caption text-muted-foreground">Last 30 days</p>
      <p className="mb-1 mt-2 text-caption text-muted-foreground">By month</p>
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
