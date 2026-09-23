import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { BatchTabs } from "@/components/batches/batch-tabs";
import { Gate } from "@/components/shell/gate";
import { PageTitle } from "@/components/shell/placeholder";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { formatTimeRange, WEEKDAY_SHORT } from "@/modules/batches/schedule";
import { weekCalendar } from "@/modules/batches/service";

const dayNum = (iso: string) => Number(iso.slice(8, 10));

export default async function CalendarPage({ searchParams }: PageProps<"/batches/calendar">) {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!can(ctx, "batches", "batches:read")) return <Gate permission="batches:read">{null}</Gate>;
  const date = (await searchParams).date;
  const selected = await selectedBranchIds(session);
  const branchId = selected.length === 1 ? selected[0] : undefined;
  const cal = await withTenant(session.tenant.id, (tx) => weekCalendar(tx, ctx, { ...(typeof date === "string" ? { date } : {}), ...(branchId ? { branchId } : {}) }));
  const multiBranch = new Set(Object.values(cal.batches).map((b) => b.branchId)).size > 1;

  return (
    <Gate permission="batches:read">
      <PageTitle>{"Programs & {batch.many}"}</PageTitle>
      <BatchTabs />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon" nativeButton={false} render={<Link href={`/batches/calendar?date=${addDays(cal.weekStart, -7)}`} aria-label="Previous week" />}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" nativeButton={false} render={<Link href={`/batches/calendar?date=${addDays(cal.weekStart, 7)}`} aria-label="Next week" />}>
          <ChevronRight />
        </Button>
        <h2 className="text-heading">Week of {formatDate(cal.weekStart)}</h2>
        {cal.today < cal.weekStart || cal.today > addDays(cal.weekStart, 6) ? (
          <Link href="/batches/calendar" className="ml-auto text-body text-accent-600 hover:underline">
            This week
          </Link>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-7 md:gap-2">
        {cal.days.map((d) => (
          <section key={d.date} className={cn("rounded-xl border border-border md:min-h-48", d.date === cal.today && "border-accent-600")}>
            <header className={cn("flex items-baseline gap-2 border-b border-border px-3 py-2", d.date === cal.today && "bg-accent-50")}>
              <span className="text-label">{WEEKDAY_SHORT[d.weekday]}</span>
              <span className="text-label text-muted-foreground tabular-nums">{dayNum(d.date)}</span>
              {d.holidays.length ? <span className="ml-auto truncate text-caption text-warning-600" title={d.holidays.join(", ")}>{d.holidays.join(", ")}</span> : null}
            </header>
            <ul className="flex flex-col gap-1 p-2">
              {d.blocks.length ? (
                d.blocks.map((block) => {
                  const b = cal.batches[block.key];
                  return (
                    <li key={`${block.key}-${block.startTime}`}>
                      <Link href={`/batches/${block.key}`} className={cn("block rounded-lg border border-border px-2 py-1.5 hover:bg-neutral-50", block.holiday && "opacity-60")}>
                        <div className="text-caption tabular-nums text-muted-foreground">{formatTimeRange(block.startTime, block.endTime)}</div>
                        <div className={cn("truncate text-label", block.holiday && "line-through")}>{b?.name}</div>
                        <div className="truncate text-caption text-muted-foreground">
                          {block.holiday ? "Holiday" : [b?.coachName, b?.resourceName, multiBranch ? b?.branchName : null].filter(Boolean).join(" · ")}
                        </div>
                      </Link>
                    </li>
                  );
                })
              ) : (
                <li className="px-1 py-2 text-caption text-muted-foreground">—</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </Gate>
  );
}
