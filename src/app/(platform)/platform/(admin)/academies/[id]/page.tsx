import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityIcon } from "@/components/activity-icon";
import { BillStatus } from "@/components/bill-status";
import { CancelButton } from "@/components/billing/cancel-button";
import { AccessForm, ModulesForm, OwnerInvite, PlanChangeForm } from "@/components/platform/academy-forms";
import { PriceSheet, ReasonAction, RecordPayment, TrialDaysSheet } from "@/components/platform/billing-forms";
import { METHOD_LABEL, perCycle, planLabel, priceNote, subscriptionState, totalsText } from "@/components/billing-text";
import { Card, CardHeader } from "@/components/ui/card";
import { MODULES } from "@/lib/auth/permissions";
import { requirePlatformPage } from "@/lib/auth/server";
import { addDays, formatDate, formatDayMonth, todayIn } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatPaise, rupeesText } from "@/lib/money/format";
import { tenantOrigin } from "@/lib/tenant/origin";
import { allPlans, effectivePrice } from "@/modules/billing/service";
import { academyDetail, type BranchActivity } from "@/modules/platform/academies";

const words = (s: string) => (s[0]?.toUpperCase() ?? "") + s.slice(1).replace("_", " ");

// More students than the plan allows (its limit was lowered): nobody is removed.
const over = (s: BranchActivity) => s.plan.maxStudents !== null && s.students > s.plan.maxStudents;
const locked = (s: BranchActivity) => s.status === "paused" || s.status === "pending";
const METHODS = Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }));

// What recording a payment does, in the sheet.
function paymentHint(s: BranchActivity): string {
  if (s.status === "pending") return "The first period: it starts today.";
  if (s.status === "trial") return "The first period: it starts when the trial ends.";
  return "Pays the oldest bills first.";
}

// One academy: owner, each branch's activities on their plans (agreed
// 2026-09-30), modules, and access (Prompt 21).
export default async function AcademyPage({ params }: PageProps<"/platform/academies/[id]">) {
  await requirePlatformPage();
  const { id } = await params;
  const a = await academyDetail(id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const today = todayIn(a.timezone);
  const plans = (await allPlans()).map((p) => ({ value: p.id, activityKey: p.activityKey, label: planLabel(p) }));
  return (
    <>
      <Link href="/platform" className="text-label text-accent-600 hover:underline">
        ← Academies
      </Link>
      <h1 className="mt-1 text-display">{a.name}</h1>
      <p className="mb-4 text-caption text-muted-foreground">
        <a href={tenantOrigin(a.slug)} className="hover:underline">
          {a.slug}
        </a>{" "}
        · {words(a.type)} · since {formatDate(a.createdAt)} · {a.status === "active" ? "● Active" : "⏸ Suspended"}
      </p>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Owner" />
          {a.owner ? (
            <>
              <p className="text-body">
                {a.owner.name} <span className="text-caption text-muted-foreground">· {a.owner.email}</span>
              </p>
              <p className="mb-3 text-caption text-muted-foreground">{a.owner.signedUp ? "Has set a password" : "Hasn't set a password yet"}</p>
              <OwnerInvite academyId={a.id} />
            </>
          ) : (
            <p className="text-body text-muted-foreground">No owner.</p>
          )}
        </Card>
        <Card>
          <CardHeader title={`Branches · ${totalsText(a.totals)}`} />
          <p className={a.staffLimit !== null && a.staff > a.staffLimit ? "text-caption text-danger-600" : "text-caption text-muted-foreground"}>
            {a.staffLimit === null ? `${a.staff} staff · no limit` : `${a.staff} of ${a.staffLimit} staff`}
          </p>
          <ul className="divide-y divide-neutral-100">
            {a.branches.map((b) => (
              <li key={b.id} className="py-3">
                <p className="text-body font-medium text-neutral-900">
                  {b.name}
                  {b.isDefault ? <span className="text-caption text-muted-foreground"> · first branch</span> : null}
                </p>
                {b.activities.length ? (
                  b.activities.map((s) => (
                    <div key={s.id} className="mt-2 flex flex-col gap-1">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-body">
                        <span>
                          <ActivityIcon name={s.activityIcon} className="mr-1.5 inline size-4 align-[-2px] text-accent-600" />
                          {s.activityName} · {s.plan.name}{" "}
                          <span className={locked(s) || over(s) ? "text-caption text-danger-600" : "text-caption text-muted-foreground"}>
                            · {s.plan.maxStudents === null ? `${s.students} students` : `${s.students}/${s.plan.maxStudents} students`} · {subscriptionState(s)}
                          </span>
                        </span>
                        <span className="tabular-nums">{perCycle(effectivePrice(s, today), s.billingInterval)}</span>
                      </p>
                      {s.nextPlanName ? <p className="text-caption text-muted-foreground">Moves to {s.nextPlanName} on {formatDate(s.periodEnd)}</p> : null}
                      {priceNote(s, today) ? <p className="text-caption text-accent-600">{priceNote(s, today)}</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <PlanChangeForm subscriptionId={s.id} current={s.planId} plans={plans.filter((p) => p.activityKey === s.activityKey)} />
                        <CancelButton path={`/api/platform/subscriptions/${s.id}`} cancelling={s.cancelAtPeriodEnd} waiting={s.status === "pending"} size="lg" />
                        <PriceSheet
                          subscriptionId={s.id}
                          title={`Price for ${s.activityName} at ${b.name}`}
                          current={{ price: s.overridePaise === null ? "" : rupeesText(s.overridePaise), until: s.overrideUntil ?? "", reason: s.overrideReason ?? "" }}
                        />
                        {s.status === "trial" || s.status === "pending" ? (
                          <TrialDaysSheet
                            subscriptionId={s.id}
                            title={`Trial days for ${s.activityName} at ${b.name}`}
                            hint={s.status === "trial" ? `On trial until ${formatDate(s.periodEnd)}; the days are added to its end.` : "It goes back on trial from today."}
                          />
                        ) : null}
                        {s.duePaise > 0n ? (
                          <RecordPayment
                            subscriptionId={s.id}
                            title={`${s.activityName} at ${b.name}`}
                            hint={paymentHint(s)}
                            due={rupeesText(s.duePaise)}
                            today={today}
                            methods={METHODS}
                          />
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="mt-1 text-caption text-muted-foreground">No activity on</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Bills" />
          {a.invoices.length ? (
            <ul className="divide-y divide-neutral-100">
              {a.invoices.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 py-3">
                  <span className="text-body">
                    {i.description}
                    <span className="block text-caption text-muted-foreground">
                      {i.number} · {formatDayMonth(i.periodStart)} – {formatDate(addDays(i.periodEnd, -1))}
                    </span>
                    {i.voidReason ? <span className="block text-caption text-muted-foreground">Void: {i.voidReason}</span> : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 whitespace-nowrap">
                    <span className="tabular-nums">{formatPaise(i.totalPaise)}</span>
                    <BillStatus bill={i} today={today} />
                    {i.status === "open" && i.paidPaise > 0n ? <span className="text-caption text-muted-foreground">{formatPaise(i.totalPaise - i.paidPaise)} left</span> : null}
                    {i.status === "open" && i.paidPaise === 0n ? (
                      <ReasonAction trigger="Void" title={`Void ${i.number}`} hint="It keeps its number and isn't owed." path={`/api/platform/billing-invoices/${i.id}/void`} submitLabel="Void bill" />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">No bills yet.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Payments" />
          {a.payments.length ? (
            <ul className="divide-y divide-neutral-100">
              {a.payments.map((p) => (
                <li key={p.id} className={p.cancelledAt ? "flex items-start justify-between gap-3 py-3 text-muted-foreground" : "flex items-start justify-between gap-3 py-3"}>
                  <span className="text-body">
                    {p.activityName} · {p.branchName}
                    <span className="block text-caption text-muted-foreground">
                      {formatDate(p.receivedOn)} · {METHOD_LABEL[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                    {p.cancelledAt ? <span className="block text-caption">Cancelled: {p.cancelReason}</span> : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={p.cancelledAt ? "tabular-nums line-through" : "tabular-nums"}>{formatPaise(p.amountPaise)}</span>
                    {p.cancelledAt ? null : (
                      <ReasonAction
                        trigger="Cancel"
                        title="Cancel payment"
                        hint="Its money comes off its bills. A payment that started its module puts it back to waiting."
                        path={`/api/platform/billing-payments/${p.id}/cancel`}
                        submitLabel="Cancel payment"
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">No payments yet.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Features" />
          <ModulesForm academyId={a.id} modules={MODULES.filter((m) => m !== "core").map((m) => ({ key: m, label: words(m), on: a.modules[m] !== false }))} />
        </Card>
        <Card>
          <CardHeader title="Access" />
          <p className="mb-3 text-caption text-muted-foreground">
            {a.status === "suspended" ? "Staff and parents can't sign in; nothing is deleted." : "Suspending ends every session and stops sign-in; nothing is deleted."}
          </p>
          <AccessForm key={a.status} academyId={a.id} suspended={a.status === "suspended"} />
        </Card>
      </div>
    </>
  );
}
