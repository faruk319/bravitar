import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { Roster } from "@/components/attendance/roster";
import { Composer } from "@/components/messaging/composer";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { allows, can } from "@/lib/auth/can";
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
  const canMessage = allows(ctx, "messages:send");
  // Saved marks only: a mark on screen but not saved yet isn't news for a family.
  const absent = canMessage ? view.entries.filter((e) => e.mark === "absent" && !e.trial) : [];
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
        <Button variant="ghost" size="icon" nativeButton={false} render={<a href={coach ? "/today?all=1" : "/today"} aria-label="Back" />}>
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
      {view.lock === "cancelled" && canMessage && view.entries.length ? (
        <div className="mb-3">
          <Composer request={{ key: "class_cancelled", sessionId: s.id }} label="Tell families" />
        </div>
      ) : null}
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
      {absent.length ? (
        <section className="mt-5">
          <h2 className="mb-1 text-label text-muted-foreground">Absent</h2>
          <ul className="divide-y divide-neutral-100 rounded-2xl border border-neutral-100 bg-card px-4 shadow-card">
            {absent.map((e) => (
              <li key={e.studentId} className="flex min-h-14 items-center justify-between gap-3">
                <span className="truncate text-body">{e.name}</span>
                <Composer request={{ key: "absent", sessionId: s.id, studentId: e.studentId }} label="Message" size="sm" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Gate>
  );
}
