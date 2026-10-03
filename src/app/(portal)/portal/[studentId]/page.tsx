import { ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MARK_STYLE } from "@/components/attendance/mark-badge";
import { Avatar } from "@/components/avatar";
import { Meter } from "@/components/reports/bars";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { StatusBadge } from "@/components/students/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { requireGuardianPage } from "@/lib/auth/server";
import { formatDate, formatDayMonth, formatMonthYear, monthEnd, weekdayOf } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { Mark } from "@/modules/attendance/schema";
import { type ChildAttendance, type ChildPage, childPage } from "@/modules/portal/service";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];
const WORST: Mark[] = ["absent", "late", "excused", "present"]; // a day with two classes shows the one to notice
const TILES: Mark[] = ["present", "late", "absent", "excused"];

function shiftMonth(month: string, by: number): string {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

// docs/07 student-profile look: class days tinted by their mark, with the
// mark's icon so colour never carries it alone; today ringed.
function Attendance({ p, a }: { p: ChildPage; a: ChildAttendance }) {
  const first = `${p.month}-01`;
  const days = Number(monthEnd(p.month).slice(8));
  const byDay = new Map<string, ChildAttendance["days"]>();
  for (const d of a.days) byDay.set(d.date, [...(byDay.get(d.date) ?? []), d]);
  const { present, late, absent } = a.counts;
  const nav = "inline-flex size-10 items-center justify-center rounded-lg hover:bg-neutral-50";
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-heading">Attendance · {formatMonthYear(first)}</h2>
        <div className="flex">
          <Link href={`/portal/${p.child.id}?month=${shiftMonth(p.month, -1)}`} aria-label="Previous month" className={nav}>
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          {p.month < p.today.slice(0, 7) ? (
            <Link href={`/portal/${p.child.id}?month=${shiftMonth(p.month, 1)}`} aria-label="Next month" className={nav}>
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          ) : (
            <span className="size-10" />
          )}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK.map((w, i) => (
          <span key={`${w}${i}`} className="py-1 text-caption text-muted-foreground" aria-hidden>
            {w}
          </span>
        ))}
        {Array.from({ length: weekdayOf(first) }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${p.month}-${String(i + 1).padStart(2, "0")}`;
          const classes = byDay.get(date) ?? [];
          const mark = WORST.find((m) => classes.some((c) => c.mark === m));
          const said = classes.map((c) => `${c.batchName}: ${c.mark ? MARK_STYLE[c.mark].word : "not marked"}`).join(", ");
          return (
            <span
              key={date}
              title={said || undefined}
              aria-label={`${formatDate(date)}${said ? `, ${said}` : ""}`}
              className={cn(
                "flex h-12 flex-col items-center justify-center rounded-lg text-label tabular-nums",
                classes.length ? (mark ? MARK_STYLE[mark].cls : "bg-neutral-100 text-neutral-700") : "text-neutral-500",
                date === p.today && "ring-2 ring-accent-600",
              )}
            >
              {i + 1}
              {classes.length ? (
                <span aria-hidden className="text-caption leading-none">
                  {mark ? MARK_STYLE[mark].icon : "○"}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map((k) => (
          <div key={k} className={cn("rounded-xl px-3 py-2", MARK_STYLE[k].cls)}>
            <p className="text-label">{MARK_STYLE[k].word}</p>
            <p className="text-display tabular-nums">{a.counts[k]}</p>
          </div>
        ))}
      </div>
      {present + late + absent ? (
        <div className="mt-4">
          <p className="mb-1 flex justify-between text-label">
            <span>
              {present + late} of {present + late + absent} classes
            </span>
            <span className="tabular-nums">{a.percent}%</span>
          </p>
          <Meter fraction={(a.percent ?? 0) / 100} />
        </div>
      ) : (
        <p className="mt-4 text-body text-muted-foreground">No classes marked{p.month === p.today.slice(0, 7) ? " yet" : ""}.</p>
      )}
    </Card>
  );
}

// docs/03 §12 and docs/07 §7.8: attendance, fees, timings, notices. Read only.
export default async function ChildPortalPage({ params, searchParams }: PageProps<"/portal/[studentId]">) {
  const s = await requireGuardianPage();
  const { studentId } = await params;
  const { month } = await searchParams;
  const p = await withTenant(s.tenant.id, (tx) => childPage(tx, { tenantId: s.tenant.id, guardianId: s.actor.id }, studentId, { month: typeof month === "string" ? month : undefined })).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const c = p.child;

  return (
    <div className="flex flex-col">
      {p.children.length > 1 ? <SegmentedTabs label="Children" items={p.children.map((k) => ({ href: `/portal/${k.id}`, label: k.fullName, active: k.id === c.id }))} /> : null}
      <div className="grid items-start gap-4 md:grid-cols-[300px_1fr]">
        <Card className="flex flex-col items-center text-center">
          <Avatar name={c.fullName} size="lg" />
          <h1 className="mt-3 text-display">{c.fullName}</h1>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-label tabular-nums">{c.code}</span>
            {p.timings.map((t) => (
              <span key={t.batchName} className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-label">
                {t.batchName}
              </span>
            ))}
            <StatusBadge status={c.status} />
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {p.attendance ? <Attendance p={p} a={p.attendance} /> : null}

          {p.fees ? (
            <Card>
              <CardHeader
                title="Fees"
                action={
                  p.receipts ? (
                    <Link href="/portal/receipts" className="text-label text-accent-600 hover:underline">
                      Receipts
                    </Link>
                  ) : undefined
                }
              />
              {p.fees.length ? (
                <ul className="divide-y divide-neutral-100">
                  {p.fees.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="min-w-0">
                        <span className="block text-body font-medium tabular-nums">{formatPaise(f.duePaise)}</span>
                        <span className="block text-caption text-muted-foreground">
                          {f.number ?? "Invoice"} · due {formatDate(f.dueDate)}
                        </span>
                        {f.overdue ? (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-danger-600/10 px-2 py-0.5 text-caption text-danger-600">
                            <span aria-hidden>!</span> Overdue
                          </span>
                        ) : null}
                      </span>
                      {f.payOnline ? (
                        <Button variant="outline" nativeButton={false} render={<a href={`/portal/pay/${f.id}`} />}>
                          Pay online
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-body text-success-600">
                  <CircleCheck className="size-5" aria-hidden /> Nothing pending
                </p>
              )}
            </Card>
          ) : p.receipts ? (
            <Card>
              <CardHeader
                title="Receipts"
                action={
                  <Link href="/portal/receipts" className="text-label text-accent-600 hover:underline">
                    See all
                  </Link>
                }
              />
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Class timings" />
            {p.timings.length ? (
              <ul className="divide-y divide-neutral-100">
                {p.timings.map((t) => (
                  <li key={t.batchName} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="block text-body font-medium">{t.batchName}</span>
                      <span className="block text-caption text-muted-foreground">
                        {t.programName}
                        {t.paused ? " · paused" : ""}
                      </span>
                    </span>
                    <span className="text-label">{t.schedule}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">Not in a class right now.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Notices" />
            {p.notices.length ? (
              <ul className="divide-y divide-neutral-100">
                {p.notices.map((n) => (
                  <li key={`${n.date}${n.text}`} className="flex min-h-12 items-center gap-3 py-2">
                    <span className="w-16 shrink-0 text-label text-muted-foreground">{formatDayMonth(n.date)}</span>
                    <span className="text-body">{n.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">Nothing in the next 30 days.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
