import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityIcon } from "@/components/activity-icon";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { AccessForm, CancelAtPeriodEnd, ModulesForm, OwnerInvite, PlanChangeForm } from "@/components/platform/academy-forms";
import { perCycle, planLabel, subscriptionState, totalsText } from "@/components/platform/billing-text";
import { Card, CardHeader } from "@/components/ui/card";
import { MODULES } from "@/lib/auth/permissions";
import { requirePlatformPage } from "@/lib/auth/server";
import { addDays, formatDate, formatDayMonth, todayIn } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { tenantOrigin } from "@/lib/tenant/origin";
import { allPlans, effectivePrice } from "@/modules/billing/service";
import { academyDetail, type BranchActivity } from "@/modules/platform/academies";

const words = (s: string) => (s[0]?.toUpperCase() ?? "") + s.slice(1).replace("_", " ");

// More students than the plan allows (its limit was lowered): nobody is removed.
const over = (s: BranchActivity) => s.plan.maxStudents !== null && s.students > s.plan.maxStudents;

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
                          <span className={s.status === "paused" || over(s) ? "text-caption text-danger-600" : "text-caption text-muted-foreground"}>
                            · {s.plan.maxStudents === null ? `${s.students} students` : `${s.students}/${s.plan.maxStudents} students`} · {subscriptionState(s)}
                          </span>
                        </span>
                        <span className="tabular-nums">{perCycle(effectivePrice(s, today), s.billingInterval)}</span>
                      </p>
                      {s.nextPlanName ? <p className="text-caption text-muted-foreground">Moves to {s.nextPlanName} on {formatDate(s.periodEnd)}</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <PlanChangeForm subscriptionId={s.id} current={s.planId} plans={plans.filter((p) => p.activityKey === s.activityKey)} />
                        <CancelAtPeriodEnd subscriptionId={s.id} cancelling={s.cancelAtPeriodEnd} />
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
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 whitespace-nowrap">
                    <span className="tabular-nums">{formatPaise(i.totalPaise)}</span>
                    {i.status === "open" && today <= i.dueOn ? (
                      <span className="text-caption text-muted-foreground">Due {formatDayMonth(i.dueOn)}</span>
                    ) : (
                      <InvoiceStatus status={i.status === "paid" ? "paid" : "issued"} overdue={i.status === "open"} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">No bills yet.</p>
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
