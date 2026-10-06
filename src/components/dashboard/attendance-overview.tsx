import { Check, Minus, X } from "lucide-react";

type Split = { present: number; absent: number; notMarked: number };

// Status is never colour alone: each segment also has an icon and its count in the legend.
const ROWS = [
  { key: "present", label: "Present", icon: Check, fill: "bg-success-600", text: "text-success-700" },
  { key: "absent", label: "Absent", icon: X, fill: "bg-danger-600", text: "text-danger-700" },
  { key: "notMarked", label: "Not marked", icon: Minus, fill: "bg-neutral-300", text: "text-muted-foreground" },
] as const;

export function AttendanceOverview({ data }: { data: Split }) {
  const total = data.present + data.absent + data.notMarked;
  return (
    <div>
      {total > 0 ? (
        <figure
          aria-label={`Attendance today: ${data.present} present, ${data.absent} absent, ${data.notMarked} not marked`}
          className="flex h-3 gap-0.5 overflow-hidden rounded-full"
        >
          {ROWS.filter((r) => data[r.key] > 0).map((r) => (
            <div key={r.key} className={r.fill} style={{ width: `${(data[r.key] / total) * 100}%` }} />
          ))}
        </figure>
      ) : null}
      <ul className="mt-3">
        {ROWS.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.key} className="flex min-h-10 items-center gap-2 text-body">
              <Icon className={`size-4 shrink-0 ${r.text}`} aria-hidden />
              <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
              <span className="ml-auto tabular-nums text-neutral-900">{data[r.key]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
