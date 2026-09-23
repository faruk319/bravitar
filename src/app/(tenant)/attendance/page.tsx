import { EmptyState } from "@/components/empty-state";
import { MARK_STYLE } from "@/components/attendance/mark-badge";
import { RegisterPicker } from "@/components/attendance/register-picker";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { todayIn, weekdayOf } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { cn } from "@/lib/utils";
import type { Mark } from "@/modules/attendance/schema";
import { monthGrid } from "@/modules/attendance/service";
import { WEEKDAY_SHORT } from "@/modules/batches/schedule";
import { listBatchViews } from "@/modules/batches/service";

// docs/03 §7: the monthly register per batch (docs/attandance .webp).
export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const sp = await searchParams;
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!can(ctx, "attendance", "attendance:read")) return <Gate permission="attendance:read">{null}</Gate>;
  const today = todayIn(session.tenant.timezone);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const data = await withTenant(session.tenant.id, async (tx) => {
    const batches = await listBatchViews(tx, ctx.branchIds, { includeEnded: true });
    const batchId = typeof sp.batch === "string" && batches.some((b) => b.id === sp.batch) ? sp.batch : batches[0]?.id;
    return { batches, batchId, grid: batchId ? await monthGrid(tx, ctx, batchId, month) : undefined };
  });
  const g = data.grid;
  const held = g ? g.classes.filter((c) => c.status !== "cancelled" && c.date <= today) : [];
  const rate = (studentId: string) => {
    const marks = held.map((c) => g?.marks[`${studentId}|${c.id}`]).filter((m): m is Mark => Boolean(m) && m !== "excused");
    const here = marks.filter((m) => m !== "absent").length;
    return { here, counted: marks.length, percent: marks.length ? Math.round((here / marks.length) * 100) : null };
  };

  return (
    <Gate permission="attendance:read">
      <PageHeader
        title="Attendance"
        actions={data.batchId ? <RegisterPicker batches={data.batches.map((b) => ({ id: b.id, label: `${b.name} · ${b.programName}` }))} batchId={data.batchId} month={month} /> : undefined}
      />
      {!g ? (
        <Card>
          <EmptyState title="No batches yet" hint="The register fills in as classes are marked." />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 md:p-0">
          <CardHeader title={g.batch.name} className="mb-0 px-4 pt-4 md:px-5 md:pt-5" action={<span className="text-label text-muted-foreground">{held.length} classes so far</span>} />
          {g.students.length === 0 ? (
            <p className="px-5 pb-8 text-body text-muted-foreground">No students in this batch.</p>
          ) : (
            <>
              <div className="mt-3 hidden overflow-x-auto md:block">
                <table className="w-full text-body">
                  <thead>
                    <tr className="bg-neutral-50 text-caption uppercase tracking-wide text-muted-foreground">
                      <th className="sticky left-0 bg-neutral-50 px-5 py-2.5 text-left font-medium">Student</th>
                      {g.classes.map((c) => (
                        <th key={c.id} className={cn("px-1 py-2.5 text-center font-medium", c.status === "cancelled" && "line-through")} title={c.cancelReason ?? undefined}>
                          <span className="block normal-case">{WEEKDAY_SHORT[weekdayOf(c.date)]}</span>
                          {Number(c.date.slice(8))}
                        </th>
                      ))}
                      <th className="px-5 py-2.5 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.students.map((s) => (
                      <tr key={s.id} className="border-t border-neutral-100">
                        <td className="sticky left-0 bg-card px-5 py-2">
                          <span className="block whitespace-nowrap text-neutral-900">{s.name}</span>
                          <span className="block text-caption text-muted-foreground">{s.code}</span>
                        </td>
                        {g.classes.map((c) => {
                          const m = g.marks[`${s.id}|${c.id}`];
                          return (
                            <td key={c.id} className="px-1 py-2 text-center">
                              {m ? (
                                <span className={cn("inline-flex size-8 items-center justify-center rounded-full text-label", MARK_STYLE[m].cls)} title={MARK_STYLE[m].word}>
                                  {MARK_STYLE[m].icon}
                                </span>
                              ) : (
                                <span className="text-muted-foreground" title={c.status === "cancelled" ? "Cancelled" : "Not marked"}>
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-5 py-2 text-right tabular-nums">{rate(s.id).percent ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="mt-2 divide-y divide-neutral-100 md:hidden">
                {g.students.map((s) => {
                  const r = rate(s.id);
                  return (
                    <li key={s.id} className="flex min-h-14 items-center justify-between gap-3 px-4">
                      <span className="text-body">{s.name}</span>
                      <span className="text-label tabular-nums text-muted-foreground">
                        {r.here}/{r.counted} · {r.percent ?? "—"}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      )}
    </Gate>
  );
}
