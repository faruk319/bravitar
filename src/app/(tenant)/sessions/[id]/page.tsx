import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Roster } from "@/components/attendance/roster";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { shellFor } from "@/lib/auth/shell";
import { formatDate, timeIn, weekdayOf } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { classRoster } from "@/modules/attendance/service";
import { formatTimeRange, WEEKDAY_SHORT } from "@/modules/batches/schedule";

export default async function ClassPage({ params }: PageProps<"/sessions/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!can(ctx, "batches", "sessions:read")) return <Gate permission="sessions:read">{null}</Gate>;
  const view = await withTenant(session.tenant.id, (tx) => classRoster(tx, ctx, id)).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!view) notFound();
  const coach = shellFor(session) === "coach";
  const s = view.session;
  const note =
    view.lock === "cancelled"
      ? `Cancelled · ${s.cancelReason ?? ""}`
      : view.lock === "future"
        ? `Opens on ${formatDate(s.sessionDate)}`
        : view.lock === "locked"
          ? "Locked 48 hours after class. A manager can change it."
          : !view.canMark
            ? "View only"
            : null;

  return (
    <Gate permission="sessions:read">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href={coach ? "/today?all=1" : "/today"} aria-label="Back" />}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-heading">{view.batchName}</h1>
          <p className="text-caption text-muted-foreground">
            {WEEKDAY_SHORT[weekdayOf(s.sessionDate)]}, {formatDate(s.sessionDate)} · {formatTimeRange(timeIn(view.timeZone, s.startsAt), timeIn(view.timeZone, s.endsAt))}
            {view.roomName ? ` · ${view.roomName}` : ""}
          </p>
        </div>
      </div>
      {note ? <p className="mb-3 rounded-2xl bg-neutral-100 px-4 py-3 text-body text-neutral-700">{note}</p> : null}
      {view.entries.length ? (
        <Roster
          sessionId={s.id}
          entries={view.entries}
          canMark={view.canMark}
          stickyBottom={coach ? "bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))]" : "bottom-0"}
        />
      ) : (
        <p className="text-body text-muted-foreground">No students in this batch yet.</p>
      )}
    </Gate>
  );
}
