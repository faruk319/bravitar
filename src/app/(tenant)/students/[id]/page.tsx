import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { EnrollmentActions, JoinBatch } from "@/components/enrollments/student-batches";
import { Gate } from "@/components/shell/gate";
import { StatusBadge } from "@/components/students/status-badge";
import { EditStudentSheet, PhotoConsentToggle, StatusActions } from "@/components/students/student-actions";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { addDays, formatDate, todayIn } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { StudentEnrollment } from "@/modules/enrollments/repo";
import { batchChoices, studentBatches } from "@/modules/enrollments/service";
import { studentOverview } from "@/modules/students/service";

const TABS = ["overview", "attendance", "fees", "notes"] as const;

function currentNote(e: StudentEnrollment, today: string): string {
  if (e.status === "paused") return `Paused since ${formatDate(e.pausedOn)}`;
  if (e.status === "transferred") return `Moves to ${e.nextBatchName} on ${formatDate(addDays(e.endDate ?? today, 1))}`;
  if (e.status === "left") return `Last day ${formatDate(e.endDate)}`;
  return e.startDate > today ? `Starts ${formatDate(e.startDate)}` : `Since ${formatDate(e.startDate)}`;
}

// A move on the joining day leaves an empty range: show just the day.
function pastNote(e: StudentEnrollment): string {
  const days = e.endDate && e.endDate >= e.startDate ? `${formatDate(e.startDate)} – ${formatDate(e.endDate)}` : formatDate(e.startDate);
  return e.status === "transferred" ? `${days} · moved to ${e.nextBatchName}` : `${days} · left`;
}

export default async function StudentPage({ params, searchParams }: PageProps<"/students/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as (typeof TABS)[number]) : "overview";
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const canEnroll = can(ctx, "batches", "enrollments:manage");
  const o = await withTenant(session.tenant.id, async (tx) => ({
    ...(await studentOverview(tx, ctx, id)),
    batches: await studentBatches(tx, ctx, id),
    choices: canEnroll ? (await batchChoices(tx, ctx)).map((b) => ({ id: b.id, label: `${b.name} · ${b.schedule}` })) : [],
  })).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!o) notFound();
  const canUpdate = session.isOwner || session.permissions.includes("students:update");
  const s = o.student;
  const today = todayIn(session.tenant.timezone);
  const batchLinks = can(ctx, "batches", "batches:read");

  return (
    <Gate permission="students:read">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-display">
            {s.fullName} <span className="ml-2 text-label text-muted-foreground tabular-nums">{s.code}</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-body text-muted-foreground">
            <StatusBadge status={s.status} />
            {o.batches.current.length ? <span>· {o.batches.current.map((e) => e.batchName).join(", ")}</span> : null}
            <span>· Joined {formatDate(s.joinedOn)}</span>
            {s.status === "left" ? <span>· Left {formatDate(s.leftOn)} ({s.leftReason?.replace("_", " ")})</span> : null}
          </p>
        </div>
        <div className="flex gap-2">
          <EditStudentSheet student={s} canUpdate={canUpdate} />
        </div>
      </div>

      <nav className="mt-4 flex gap-1 border-b border-border" aria-label="Sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/students/${s.id}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={cn("min-h-12 border-b-2 px-3 pt-3 text-body capitalize", t === tab ? "border-accent-600 text-accent-600 font-medium" : "border-transparent text-neutral-700")}
          >
            {t}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-border p-4 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-heading">Batches</h2>
              {canEnroll && s.status === "active" && o.choices.length ? <JoinBatch studentId={s.id} choices={o.choices} today={today} /> : null}
            </div>
            {o.batches.current.length || o.batches.past.length ? (
              <ul className="mt-2 divide-y divide-border">
                {o.batches.current.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-body">
                        {batchLinks ? <Link href={`/batches/${e.batchId}`} className="text-accent-600 hover:underline">{e.batchName}</Link> : e.batchName}{" "}
                        <span className="text-caption text-muted-foreground">{e.programName}</span>
                      </p>
                      <p className="text-caption text-muted-foreground">{currentNote(e, today)}</p>
                    </div>
                    {canEnroll && (e.status === "active" || e.status === "paused") ? <EnrollmentActions enrollment={e} choices={o.choices} today={today} /> : null}
                  </li>
                ))}
                {o.batches.past.map((e) => (
                  <li key={e.id} className="py-3 text-caption text-muted-foreground">
                    {e.batchName} · {pastNote(e)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-body text-muted-foreground">Not in a batch yet.</p>
            )}
          </section>
          <section className="rounded-xl border border-border p-4">
            <h2 className="text-heading">Family</h2>
            <p className="mt-1 text-body text-muted-foreground">{o.household?.name} · {o.siblings.length + 1} {o.siblings.length ? "students" : "student"}</p>
            <ul className="mt-3 divide-y divide-border">
              {o.guardians.map((g) => (
                <li key={g.id} className="flex min-h-12 items-center justify-between gap-3">
                  <span className="text-body">
                    {g.fullName} <span className="text-caption text-muted-foreground capitalize">· {g.relation}</span>
                  </span>
                  <a href={`tel:${g.phone}`} className="text-body text-accent-600 tabular-nums">{formatPhone(g.phone)}</a>
                </li>
              ))}
            </ul>
            {o.siblings.length ? (
              <p className="mt-3 text-body">
                Siblings:{" "}
                {o.siblings.map((sib, i) => (
                  <span key={sib.id}>
                    {i ? ", " : ""}
                    <Link href={`/students/${sib.id}`} className="text-accent-600 hover:underline">{sib.fullName}</Link>
                  </span>
                ))}
              </p>
            ) : null}
          </section>
          <section className="rounded-xl border border-border p-4">
            <h2 className="text-heading">Details</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
              <dt className="text-muted-foreground">Born</dt><dd>{formatDate(s.dateOfBirth)}</dd>
              <dt className="text-muted-foreground">Gender</dt><dd className="capitalize">{s.gender ?? "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt><dd className="tabular-nums">{s.phone ? formatPhone(s.phone) : "—"}</dd>
              <dt className="text-muted-foreground">Interested in</dt><dd>{s.metadata.programInterest ?? "—"}</dd>
            </dl>
            <div className="mt-3 border-t border-border pt-2">
              <p className="text-caption text-muted-foreground">Consent · data processing {o.consents.data_processing ? "given" : "missing"}</p>
              <PhotoConsentToggle studentId={s.id} granted={Boolean(o.consents.photo)} canUpdate={canUpdate} />
            </div>
          </section>
          <section className="md:col-span-2">
            <StatusActions student={s} canUpdate={canUpdate} />
          </section>
        </div>
      ) : tab === "attendance" ? (
        <EmptyState title="No attendance yet" hint="Marks appear once this student is in a batch." action="Enroll in a batch" soon />
      ) : tab === "fees" ? (
        <EmptyState title="No fees yet" hint="Invoices and receipts appear here." action="Collect payment" soon />
      ) : (
        <EmptyState title="No notes yet" hint="Anything the family should be remembered for." action="Add note" soon />
      )}
    </Gate>
  );
}
