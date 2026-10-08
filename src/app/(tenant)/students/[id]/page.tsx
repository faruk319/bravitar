import { FileText, History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkBadge } from "@/components/attendance/mark-badge";
import { EmptyState } from "@/components/empty-state";
import { EnrollmentActions, JoinBatch, PlanSelect } from "@/components/enrollments/student-batches";
import { EndDiscount, GiveDiscount } from "@/components/fees/discounts";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import type { DueItem } from "@/components/fees/still-due";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { AttendanceCalendar } from "@/components/students/attendance-calendar";
import { AttendanceSummaryCard } from "@/components/students/attendance-summary";
import { FeesCard } from "@/components/students/fees-card";
import { EnrollmentCard, GuardianCard, PersonalCard } from "@/components/students/overview-cards";
import { EditStudentSheet } from "@/components/students/student-actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows, can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { addDays, formatDate, todayIn, weekdayOf } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { attendanceCalendar, studentAttendance } from "@/modules/attendance/service";
import { WEEKDAY_SHORT } from "@/modules/batches/schedule";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import type { StudentEnrollment } from "@/modules/enrollments/repo";
import { batchChoices } from "@/modules/enrollments/service";
import { isOverdue } from "@/modules/fees/billing";
import { discountChoices, installmentsDue, planChoices, studentFees } from "@/modules/fees/service";
import { familyAccount } from "@/modules/payments/service";
import { profileTabs, studentProfile, TAB_LABELS } from "@/modules/students/profile";

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
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  // docs/07 §7.3: no fee information without a fees permission.
  const showFees = can(ctx, "fees", "invoices:read");
  const tabs = profileTabs(ctx);
  const today = todayIn(session.tenant.timezone);
  const picked = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const month = picked > today.slice(0, 7) ? today.slice(0, 7) : picked;
  const tab = tabs.find((t) => t === sp.tab) ?? "overview";
  const canEnroll = can(ctx, "batches", "enrollments:manage");
  const canDiscount = allows(ctx, "invoices:manage");
  const o = await withTenant(session.tenant.id, async (tx) => {
    const profile = await studentProfile(tx, ctx, id);
    return {
      ...profile,
      // docs/03 §9: the family's advance is visible on the family.
      account: showFees ? await familyAccount(tx, ctx, profile.student.id, profile.student.branchId) : undefined,
      choices: canEnroll ? (await batchChoices(tx, ctx)).map((b) => ({ id: b.id, label: `${b.name} · ${b.schedule}` })) : [],
      recent: tab === "attendance" ? await studentAttendance(tx, ctx, id) : undefined,
      calendar: tab === "attendance" || tab === "overview" ? await attendanceCalendar(tx, ctx, id, month) : undefined,
      plans: canEnroll && showFees ? await planChoices(tx, ctx) : [],
      feesTab: tab === "fees" ? await studentFees(tx, ctx, id) : undefined,
      discounts: tab === "fees" && canDiscount ? await discountChoices(tx, ctx) : [],
      due: showFees ? await installmentsDue(tx, ctx, id) : [],
    };
  }).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!o) notFound();
  const canUpdate = session.isOwner || session.permissions.includes("students:update");
  // Installments that stay due when the student leaves (docs/03 §6), shown on the leave sheets.
  const due: DueItem[] = o.due.map((i) => ({ invoiceId: i.invoiceId, enrollmentId: i.enrollmentId, description: i.description, number: i.number, dueDate: i.dueDate, amount: formatPaise(i.totalPaise - i.paidPaise), voidable: i.voidable }));
  const s = o.student;
  const batchLinks = can(ctx, "batches", "batches:read");

  const batchesCard = o.batches ? (
    <Card>
      <CardHeader title="Batches" action={canEnroll && s.status === "active" && o.choices.length ? <JoinBatch studentId={s.id} choices={o.choices} today={today} /> : null} />
      {o.batches.current.length || o.batches.past.length ? (
        <ul className="divide-y divide-neutral-100">
          {o.batches.current.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-body">
                  {batchLinks ? (
                    <Link href={`/batches/${e.batchId}`} className="font-medium text-accent-600 hover:underline">
                      {e.batchName}
                    </Link>
                  ) : (
                    <span className="font-medium">{e.batchName}</span>
                  )}{" "}
                  <span className="text-caption text-muted-foreground">{e.programName}</span>
                </p>
                <p className="text-caption text-muted-foreground">{currentNote(e, today)}</p>
                {o.plans.length && (e.status === "active" || e.status === "paused") ? (
                  <PlanSelect enrollmentId={e.id} current={e.feePlanId ? { id: e.feePlanId, name: e.planName ?? "" } : null} plans={o.plans} />
                ) : showFees && e.planName ? (
                  <p className="text-caption text-muted-foreground">Fee plan · {e.planName}</p>
                ) : null}
              </div>
              {canEnroll && (e.status === "active" || e.status === "paused") ? <EnrollmentActions enrollment={e} choices={o.choices} today={today} due={due.filter((d) => d.enrollmentId === e.id)} /> : null}
            </li>
          ))}
          {o.batches.past.map((e) => (
            <li key={e.id} className="py-3 text-caption text-muted-foreground">
              {e.batchName} · {pastNote(e)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">Not in a batch yet.</p>
      )}
    </Card>
  ) : null;

  return (
    <Gate permission="students:read">
      <PageHeader
        title={s.fullName}
        entity
        actions={
          <>
            {allows(ctx, "fees:collect") ? (
              <Button nativeButton={false} render={<Link href={`/payments/new?student=${s.id}`} />}>
                Collect
              </Button>
            ) : null}
            <EditStudentSheet student={s} canUpdate={canUpdate} />
          </>
        }
      />
      <SegmentedTabs label="Sections" items={tabs.map((t) => ({ href: `/students/${s.id}?tab=${t}`, label: TAB_LABELS[t], active: t === tab }))} />
      {tab === "overview" ? (
        <div className={cn("grid grid-cols-1 items-start gap-5", o.calendar ? "xl:grid-cols-[17rem_20rem_minmax(0,1fr)]" : "xl:grid-cols-[17rem_minmax(0,1fr)]")}>
          {/* On a phone the wrappers dissolve and `order` sets the reading order. */}
          <div className="contents xl:flex xl:flex-col xl:gap-5">
            <div className="order-1 xl:order-none">
              <PersonalCard o={o} canUpdate={canUpdate} />
            </div>
            <div className="order-5 xl:order-none">
              <GuardianCard o={o} {...(o.account ? { account: o.account } : {})} canUpdate={canUpdate} canMessage={allows(ctx, "messages:send")} />
            </div>
            <Card className="order-7 xl:order-none">
              <CardHeader title="Documents" />
              <EmptyState icon={<FileText />} title="No documents" hint="Nothing is stored here yet." />
            </Card>
          </div>
          {o.calendar ? (
            <div className="contents xl:flex xl:flex-col xl:gap-5">
              <Card className="order-4 xl:order-none">
                <AttendanceCalendar calendar={o.calendar} href={(m) => `/students/${s.id}?month=${m}`} />
              </Card>
              {o.attendance ? (
                <div className="order-6 xl:order-none">
                  <AttendanceSummaryCard attendance={o.attendance} />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="contents xl:flex xl:flex-col xl:gap-5">
            {o.fees ? (
              <div className="order-2 xl:order-none">
                <FeesCard fees={o.fees} nextDue={o.nextDue ?? null} plans={o.batches ? o.batches.current.flatMap((e) => (e.planName ? [e.planName] : [])) : undefined} studentId={s.id} />
              </div>
            ) : null}
            <div className="order-3 xl:order-none">
              <EnrollmentCard o={o} canUpdate={canUpdate} due={due} />
            </div>
            {batchesCard ? <div className="order-6 xl:order-none">{batchesCard}</div> : null}
            <Card className="order-8 xl:order-none">
              <CardHeader title="Activity" />
              <EmptyState icon={<History />} title="No activity" hint="Nothing is recorded here yet." />
            </Card>
          </div>
        </div>
      ) : tab === "batches" && batchesCard ? (
        batchesCard
      ) : tab === "documents" ? (
        <Card>
          <EmptyState icon={<FileText />} title="No documents" hint="Nothing is stored here yet." />
        </Card>
      ) : tab === "activity" ? (
        <Card>
          <EmptyState icon={<History />} title="No activity" hint="Nothing is recorded here yet." />
        </Card>
      ) : (
        <Card>
              {tab === "attendance" && o.calendar && o.recent ? (
                  <>
                    <AttendanceCalendar calendar={o.calendar} href={(m) => `/students/${s.id}?tab=attendance&month=${m}`} />
                    {o.recent.recent.length ? (
                      <>
                        <CardHeader title="Recent classes" className="mt-5" />
                        <ul className="divide-y divide-neutral-100">
                          {o.recent.recent.map((c) => (
                            <li key={c.sessionId} className="flex min-h-12 items-center justify-between gap-3">
                              <span className="text-body">
                                {WEEKDAY_SHORT[weekdayOf(c.date)]}, {formatDate(c.date)} <span className="text-caption text-muted-foreground">· {c.batchName}</span>
                              </span>
                              <MarkBadge mark={c.mark} />
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </>
              ) : tab === "fees" && o.feesTab ? (
                <>
                  <CardHeader
                    title="Discounts"
                    action={canDiscount && o.discounts.length ? <GiveDiscount studentId={s.id} today={today} discounts={o.discounts.map((d) => ({ id: d.id, label: `${d.name} · ${d.kind === "percent" ? `${d.value}%` : formatPaise(BigInt(d.value))}` }))} /> : null}
                  />
                  {o.feesTab.discounts.length ? (
                    <ul className="divide-y divide-neutral-100">
                      {o.feesTab.discounts.map((g) => {
                        const running = !g.validTo || g.validTo >= today;
                        return (
                          <li key={g.id} className={cn("flex min-h-14 items-center justify-between gap-3 py-2", !running && "text-neutral-500")}>
                            <div>
                              <p className="text-body">
                                {g.name} <span className="text-caption text-muted-foreground">· {g.kind === "percent" ? `${g.value}%` : formatPaise(BigInt(g.value))}</span>
                              </p>
                              <p className="text-caption text-muted-foreground">
                                {g.reason} · {g.validTo ? `${formatDate(g.validFrom)} – ${formatDate(g.validTo)}` : `from ${formatDate(g.validFrom)}`}
                                {g.approvedByName ? ` · by ${g.approvedByName}` : ""}
                              </p>
                            </div>
                            {canDiscount && running ? <EndDiscount id={g.id} /> : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-body text-muted-foreground">No discounts.</p>
                  )}
                  <CardHeader title="Invoices" className="mt-5" />
                  {o.feesTab.invoices.length ? (
                    <ul className="divide-y divide-neutral-100">
                      {o.feesTab.invoices.map((i) => (
                        <li key={i.id}>
                          <Link href={`/invoices/${i.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-neutral-50">
                            <span>
                              <span className="block text-body">{i.number ?? "Draft"}</span>
                              <span className="block text-caption text-muted-foreground">
                                {formatDate(i.issueDate)} · due {formatDate(i.dueDate)}
                              </span>
                            </span>
                            <span className="flex flex-col items-end gap-1">
                              <Money paise={i.totalPaise} className="text-body font-medium" />
                              <InvoiceStatus status={i.status} overdue={isOverdue(i, o.feesTab?.today ?? today)} />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body text-muted-foreground">No invoices yet.</p>
                  )}
                </>
          ) : null}
        </Card>
      )}
    </Gate>
  );
}
