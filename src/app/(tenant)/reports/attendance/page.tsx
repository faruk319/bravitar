import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Meter } from "@/components/reports/bars";
import { pickRange, RangeForm } from "@/components/reports/range-form";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import type { MarkCounts } from "@/modules/attendance/repo";
import { attendancePercent } from "@/modules/attendance/service";
import { attendanceReport, thisMonth } from "@/modules/reports/service";

type Row = MarkCounts & { key: string; name: ReactNode; note: string; percent: number | null };

function MarksTable({ first, rows }: { first: string; rows: Row[] }) {
  return (
    <Card className="overflow-x-auto p-0 md:p-0">
      <table className="w-full min-w-[40rem] text-body">
        <thead>
          <tr className="bg-neutral-50 text-left text-caption uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">{first}</th>
            {["Present", "Late", "Absent", "Excused"].map((h) => (
              <th key={h} className="py-2 pr-4 text-right font-medium">
                {h}
              </th>
            ))}
            <th className="px-4 py-2 font-medium">Attendance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-neutral-100">
              <td className="px-4 py-2">
                {r.name}
                <span className="text-caption text-muted-foreground"> · {r.note}</span>
              </td>
              {[r.present, r.late, r.absent, r.excused].map((n, i) => (
                <td key={["p", "l", "a", "e"][i]} className="py-2 pr-4 text-right tabular-nums">
                  {n}
                </td>
              ))}
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <Meter fraction={(r.percent ?? 0) / 100} className="w-16" />
                  <span className="tabular-nums">{r.percent === null ? "—" : `${r.percent}%`}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length ? null : <p className="p-6 text-center text-body text-muted-foreground">No classes marked in these dates.</p>}
    </Card>
  );
}

// docs/03 §11: by batch and by student; % = (present + late) / (present + late + absent).
export default async function AttendanceReportPage({ searchParams }: PageProps<"/reports/attendance">) {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "reports:view")) return <Gate permission="reports:view">{null}</Gate>;
  const sp = await searchParams;
  const byStudent = sp.view === "students";
  const r = await withTenant(session.tenant.id, async (tx) => attendanceReport(tx, ctx, pickRange(sp, await thisMonth(tx))));
  const all = r.batches.reduce((t, b) => ({ present: t.present + b.present, late: t.late + b.late, absent: t.absent + b.absent }), { present: 0, late: 0, absent: 0 });
  const overall = attendancePercent(all);
  const classes = r.batches.reduce((n, b) => n + b.classes, 0);
  const tab = (view?: string) => `/reports/attendance?${new URLSearchParams({ ...(view ? { view } : {}), from: r.from, to: r.to })}`;
  return (
    <Gate permission="reports:view">
      <PageHeader title="Attendance summary" crumbs={[{ href: "/reports", label: "Reports" }]}>
        <p className="text-caption text-muted-foreground">
          {overall === null ? "Nothing marked" : `${overall}% attendance`} · {classes} {classes === 1 ? "class" : "classes"} marked
        </p>
      </PageHeader>
      <RangeForm from={r.from} to={r.to} keep={byStudent ? { view: "students" } : {}} csv={`/api/reports/attendance?from=${r.from}&to=${r.to}`} />
      <SegmentedTabs
        label="Attendance summary"
        items={[
          { href: tab(), label: "By batch", active: !byStudent },
          { href: tab("students"), label: "By student", active: byStudent },
        ]}
      />
      {byStudent ? (
        <MarksTable
          first="Student"
          rows={r.students.map((s) => ({
            ...s,
            key: s.studentId,
            name: (
              <Link href={`/students/${s.studentId}`} className="hover:underline">
                {s.name}
              </Link>
            ),
            note: s.code,
          }))}
        />
      ) : (
        <MarksTable
          first="Batch"
          rows={r.batches.map((b) => ({
            ...b,
            key: b.batchId,
            name: (
              <Link href={`/batches/${b.batchId}`} className="hover:underline">
                {b.batchName}
              </Link>
            ),
            note: `${b.classes} ${b.classes === 1 ? "class" : "classes"}`,
          }))}
        />
      )}
    </Gate>
  );
}
