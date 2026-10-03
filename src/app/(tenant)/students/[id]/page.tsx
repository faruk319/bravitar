import { CalendarDays, type LucideIcon, Phone, Target, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { MARK_STYLE, MarkBadge } from "@/components/attendance/mark-badge";
import { EmptyState } from "@/components/empty-state";
import { EnrollmentActions, JoinBatch, PlanSelect } from "@/components/enrollments/student-batches";
import { EndDiscount, GiveDiscount } from "@/components/fees/discounts";
import { Composer } from "@/components/messaging/composer";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import type { DueItem } from "@/components/fees/still-due";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { AddFamilyMember, FamilyMemberActions } from "@/components/students/family";
import { StatusBadge } from "@/components/students/status-badge";
import { EditStudentSheet, PhotoConsentToggle, StatusActions } from "@/components/students/student-actions";
import { WhatsappOptin } from "@/components/students/whatsapp-optin";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows, can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { addDays, formatDate, todayIn, weekdayOf } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { studentAttendance } from "@/modules/attendance/service";
import { WEEKDAY_SHORT } from "@/modules/batches/schedule";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { sum } from "@/lib/money/paise";
import { formatPhone } from "@/lib/phone";
import type { StudentEnrollment } from "@/modules/enrollments/repo";
import { batchChoices, studentBatches } from "@/modules/enrollments/service";
import { isOverdue } from "@/modules/fees/billing";
import { discountChoices, installmentsDue, planChoices, studentFees } from "@/modules/fees/service";
import { familyAccount } from "@/modules/payments/service";
import { RELATION_LABELS } from "@/modules/students/relations";
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
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  // docs/07 §7.3: no fee information without a fees permission.
  const showFees = can(ctx, "fees", "invoices:read");
  const tabs = TABS.filter((t) => t !== "fees" || showFees);
  const tab = tabs.find((t) => t === sp.tab) ?? "overview";
  const canEnroll = can(ctx, "batches", "enrollments:manage");
  const canDiscount = allows(ctx, "invoices:manage");
  const o = await withTenant(session.tenant.id, async (tx) => {
    const overview = await studentOverview(tx, ctx, id);
    return {
      ...overview,
      // docs/03 §9: the family's advance is visible on the family.
      account: showFees ? await familyAccount(tx, ctx, overview.student.householdId, overview.student.branchId) : undefined,
      batches: await studentBatches(tx, ctx, id),
      choices: canEnroll ? (await batchChoices(tx, ctx)).map((b) => ({ id: b.id, label: `${b.name} · ${b.schedule}` })) : [],
      attendance: tab === "attendance" ? await studentAttendance(tx, ctx, id) : undefined,
      plans: canEnroll && showFees ? await planChoices(tx, ctx) : [],
      fees: tab === "fees" ? await studentFees(tx, ctx, id) : undefined,
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
  const today = todayIn(session.tenant.timezone);
  const batchLinks = can(ctx, "batches", "batches:read");

  const details: [LucideIcon, string, string][] = [
    [CalendarDays, "Born", formatDate(s.dateOfBirth)],
    [UserRound, "Gender", s.gender ? s.gender[0]?.toUpperCase() + s.gender.slice(1) : "—"],
    [Phone, "Phone", s.phone ? formatPhone(s.phone) : "—"],
    [Target, "Interested in", s.metadata.programInterest ?? "—"],
  ];

  return (
    <Gate permission="students:read">
      <PageHeader
        title={s.fullName}
        crumbs={[{ label: "{student.many}", href: "/students" }]}
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
      <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
          <Card className="flex flex-col items-center text-center">
            <Avatar name={s.fullName} size="lg" />
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-label tabular-nums">{s.code}</span>
              <StatusBadge status={s.status} />
            </div>
            <p className="mt-2 text-caption text-muted-foreground">
              Joined {formatDate(s.joinedOn)}
              {s.status === "left" ? ` · Left ${formatDate(s.leftOn)} (${s.leftReason?.replace("_", " ")})` : ""}
            </p>
            <dl className="mt-4 w-full divide-y divide-neutral-100 text-left">
              {details.map(([Icon, k, v]) => (
                <div key={k} className="flex min-h-12 items-center gap-3">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <dt className="text-label text-muted-foreground">{k}</dt>
                  <dd className="ml-auto text-right text-body tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 w-full border-t border-neutral-100 pt-3 text-left">
              <p className="text-caption text-muted-foreground">Consent · data processing {o.consents.data_processing ? "given" : "missing"}</p>
              <PhotoConsentToggle studentId={s.id} granted={Boolean(o.consents.photo)} canUpdate={canUpdate} />
            </div>
            <div className="mt-3 w-full [&>div]:justify-center">
              <StatusActions student={s} canUpdate={canUpdate} due={due} />
            </div>
          </Card>
        <div className="min-w-0 lg:row-span-2">
          <SegmentedTabs label="Sections" items={tabs.map((t) => ({ href: `/students/${s.id}?tab=${t}`, label: t[0]?.toUpperCase() + t.slice(1), active: t === tab }))} />
          {tab === "overview" ? (
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
          ) : (
            <Card>
              {tab === "attendance" ? (
                o.attendance?.recent.length ? (
                  <>
                    <CardHeader title="Last 30 days" action={<span className="text-display">{o.attendance.percent === null ? "—" : `${o.attendance.percent}%`}</span>} />
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {(["present", "late", "absent", "unmarked"] as const).map((k) => (
                        <div key={k} className={cn("rounded-xl px-4 py-3", k === "unmarked" ? "bg-neutral-100 text-neutral-700" : MARK_STYLE[k].cls)}>
                          <p className="text-label">{k === "unmarked" ? "Not marked" : MARK_STYLE[k].word}</p>
                          <p className="text-display tabular-nums">{o.attendance?.counts[k]}</p>
                        </div>
                      ))}
                    </div>
                    <ul className="mt-4 divide-y divide-neutral-100">
                      {o.attendance.recent.map((c) => (
                        <li key={c.sessionId} className="flex min-h-12 items-center justify-between gap-3">
                          <span className="text-body">
                            {WEEKDAY_SHORT[weekdayOf(c.date)]}, {formatDate(c.date)} <span className="text-caption text-muted-foreground">· {c.batchName}</span>
                          </span>
                          <MarkBadge mark={c.mark} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <EmptyState title="No classes yet" hint="Marks appear here once this student's classes are taken." />
                )
              ) : tab === "fees" && o.fees ? (
                <>
                  <CardHeader
                    title="Discounts"
                    action={canDiscount && o.discounts.length ? <GiveDiscount studentId={s.id} today={today} discounts={o.discounts.map((d) => ({ id: d.id, label: `${d.name} · ${d.kind === "percent" ? `${d.value}%` : formatPaise(BigInt(d.value))}` }))} /> : null}
                  />
                  {o.fees.discounts.length ? (
                    <ul className="divide-y divide-neutral-100">
                      {o.fees.discounts.map((g) => {
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
                  {o.fees.invoices.length ? (
                    <ul className="divide-y divide-neutral-100">
                      {o.fees.invoices.map((i) => (
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
                              <InvoiceStatus status={i.status} overdue={isOverdue(i, o.fees?.today ?? today)} />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body text-muted-foreground">No invoices yet.</p>
                  )}
                </>
              ) : (
                <EmptyState title="No notes yet" hint="Anything the family should be remembered for." action="Add note" soon />
              )}
            </Card>
          )}
        </div>
          <Card className="lg:col-start-1">
            <CardHeader title="Family" action={allows(ctx, "messages:send") ? <Composer request={{ key: "welcome", studentId: s.id }} label="Welcome message" size="sm" /> : null} />
            <p className="-mt-2 text-caption text-muted-foreground">
              {o.household?.name} · {o.siblings.length + 1} {o.siblings.length ? "students" : "student"}
            </p>
            {o.account && (o.account.open.length || o.account.advancePaise > 0n) ? (
              <dl className="mt-2 divide-y divide-neutral-100 border-y border-neutral-100">
                {o.account.open.length ? (
                  <div className="flex min-h-12 items-center justify-between gap-3">
                    <dt className="text-label text-muted-foreground">Due</dt>
                    <dd>
                      <Money paise={sum(o.account.open.map((i) => i.balancePaise))} className="text-body font-medium" />
                    </dd>
                  </div>
                ) : null}
                {o.account.advancePaise > 0n ? (
                  <div className="flex min-h-12 items-center justify-between gap-3">
                    <dt className="text-label text-muted-foreground">Advance</dt>
                    <dd>
                      <Money paise={o.account.advancePaise} className="text-body font-medium" />
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <ul className="mt-2 divide-y divide-neutral-100">
              {o.guardians.map((g) => (
                <li key={g.id} className="flex min-h-14 items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-body">
                      {g.fullName} <span className="text-caption text-muted-foreground">· {RELATION_LABELS[g.relation]}</span>
                      {g.isManager ? <span className="ml-1.5 rounded-full bg-accent-50 px-2 py-0.5 text-caption text-accent-600">Manager</span> : null}
                    </span>
                    <WhatsappOptin guardianId={g.id} on={g.whatsappOptin} canUpdate={canUpdate} />
                    {canUpdate && !g.isManager ? <FamilyMemberActions studentId={s.id} guardianId={g.id} removable={!g.isPrimary} /> : null}
                  </span>
                  <a href={`tel:${g.phone}`} className="text-body text-accent-600 tabular-nums">
                    {formatPhone(g.phone)}
                  </a>
                </li>
              ))}
            </ul>
            {canUpdate ? <AddFamilyMember studentId={s.id} /> : null}
            {o.siblings.length ? (
              <p className="mt-2 text-body">
                Siblings:{" "}
                {o.siblings.map((sib, i) => (
                  <span key={sib.id}>
                    {i ? ", " : ""}
                    <Link href={`/students/${sib.id}`} className="text-accent-600 hover:underline">
                      {sib.fullName}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </Card>
      </div>
    </Gate>
  );
}
