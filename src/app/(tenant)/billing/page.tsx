import Link from "next/link";
import { ActivityIcon } from "@/components/activity-icon";
import { BillStatus } from "@/components/bill-status";
import { CancelButton } from "@/components/billing/cancel-button";
import { AddBranch, AddModule, ChangePlan, RenameBranch } from "@/components/billing/owner-forms";
import { METHOD_LABEL, perCycle, planChoice, priceNote, subscriptionState } from "@/components/billing-text";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { addDays, formatDate, formatDayMonth } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { type OwnerBranch, type OwnerModule, billingPage } from "@/modules/billing/owner";
import { effectivePrice } from "@/modules/billing/service";

const students = (m: OwnerModule) => (m.plan.maxStudents === null ? `${m.students} students` : `${m.students}/${m.plan.maxStudents} students`);

// The academy's Billing (agreed 2026-09-30): each branch's modules, what they
// cost and what's due, and Bravitar's bills and payments. Paid outside the app
// for now, as the "How to pay" text says; Bravitar records it.
export default async function BillingPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "billing:view")) return <Gate permission="billing:view">{null}</Gate>;
  const d = await withTenant(session.tenant.id, (tx) => billingPage(tx, ctx));
  const dues = d.branches.flatMap((b) => b.modules.filter((m) => m.duePaise > 0n).map((m) => ({ m, branch: b.name })));
  const can = { manage: allows(ctx, "billing:manage"), rename: allows(ctx, "settings:manage") };
  const plans = d.offer.plans.map((p) => ({ value: p.id, label: planChoice(p), activityKey: p.activityKey }));
  const startable = d.offer.modules.filter((a) => plans.some((p) => p.activityKey === a.key)).map((a) => ({ value: a.key, label: a.name }));
  const addable = (b: OwnerBranch) => startable.filter((a) => !b.modules.some((m) => m.activityKey === a.value));
  // Offered plans, and the current one even when it isn't.
  const planOptions = (m: OwnerModule) => [
    ...(d.offer.plans.some((p) => p.id === m.planId) ? [] : [{ value: m.planId, label: planChoice(m.plan) }]),
    ...plans.filter((p) => p.activityKey === m.activityKey),
  ];
  return (
    <>
      <PageHeader title="Billing" actions={can.manage && !ctx.branchIds.length && startable.length ? <AddBranch modules={startable} plans={plans} /> : null}>
        <p className={cn("text-caption", d.staffLimit !== null && d.staff > d.staffLimit ? "text-danger-600" : "text-muted-foreground")}>
          {d.staffLimit === null ? `${d.staff} staff · no limit` : `${d.staff} of ${d.staffLimit} staff`}
        </p>
      </PageHeader>
      {dues.length ? (
        <Card className="mb-5">
          <CardHeader title="How to pay" />
          <ul className="mb-3 divide-y divide-neutral-100">
            {dues.map(({ m, branch }) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 py-2 text-body">
                <span>
                  {m.activityName} at {branch}
                </span>
                <span className="tabular-nums">{formatPaise(m.duePaise)}</span>
              </li>
            ))}
          </ul>
          <p className="text-body whitespace-pre-line text-muted-foreground">{d.howToPay ?? "Bravitar will tell you how to pay."}</p>
        </Card>
      ) : null}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {d.branches.map((b) => (
          <Card key={b.id}>
            <CardHeader title={b.name} action={can.rename ? <RenameBranch branchId={b.id} name={b.name} /> : null} />
            {b.modules.length ? (
              <ul className="divide-y divide-neutral-100">
                {b.modules.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <span className="text-body">
                      <ActivityIcon name={m.activityIcon} className="mr-1.5 inline size-4 align-[-2px] text-accent-600" />
                      {m.activityName} · {m.plan.name}
                      <span className={cn("block text-caption", m.status === "paused" || m.status === "pending" ? "text-danger-600" : "text-muted-foreground")}>
                        {subscriptionState(m)} · {students(m)}
                      </span>
                      {m.nextPlanName ? <span className="block text-caption text-muted-foreground">Moves to {m.nextPlanName} on {formatDate(m.periodEnd)}</span> : null}
                      {priceNote(m, d.today) ? <span className="block text-caption text-accent-600">{priceNote(m, d.today)}</span> : null}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 whitespace-nowrap">
                      <span className="tabular-nums">{perCycle(effectivePrice(m, d.today), m.billingInterval)}</span>
                      {m.duePaise > 0n ? <span className="text-caption text-danger-600">{formatPaise(m.duePaise)} to pay</span> : null}
                    </span>
                    {can.manage ? (
                      <span className="flex w-full flex-wrap gap-2">
                        <ChangePlan subscriptionId={m.id} title={`${m.activityName} at ${b.name}`} current={m.planId} plans={planOptions(m)} />
                        <CancelButton path={`/api/billing/subscriptions/${m.id}`} cancelling={m.cancelAtPeriodEnd} waiting={m.status === "pending"} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No module here.</p>
            )}
            {can.manage && addable(b).length ? (
              <div className="mt-3">
                <AddModule branchId={b.id} branchName={b.name} modules={addable(b)} plans={plans} />
              </div>
            ) : null}
          </Card>
        ))}
        <Card>
          <CardHeader title="Bills" />
          {d.bills.length ? (
            <ul className="divide-y divide-neutral-100">
              {d.bills.map((i) => (
                <li key={i.id}>
                  <Link href={`/billing/bills/${i.id}`} className="flex items-start justify-between gap-3 py-3 hover:bg-neutral-50">
                    <span className="text-body">
                      {i.description}
                      <span className="block text-caption text-muted-foreground">
                        {i.number} · {formatDayMonth(i.periodStart)} – {formatDate(addDays(i.periodEnd, -1))}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 whitespace-nowrap">
                      <span className="tabular-nums">{formatPaise(i.totalPaise)}</span>
                      <BillStatus bill={i} today={d.today} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">No bills yet.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Payments" />
          {d.payments.length ? (
            <ul className="divide-y divide-neutral-100">
              {d.payments.map((p) => (
                <li key={p.id} className={cn("flex items-start justify-between gap-3 py-3", p.cancelledAt && "text-muted-foreground")}>
                  <span className="text-body">
                    {p.activityName} at {p.branchName}
                    <span className="block text-caption text-muted-foreground">
                      {formatDate(p.receivedOn)} · {METHOD_LABEL[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""}
                      {p.cancelledAt ? " · Cancelled" : ""}
                    </span>
                  </span>
                  <span className={cn("shrink-0 tabular-nums", p.cancelledAt && "line-through")}>{formatPaise(p.amountPaise)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">No payments yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
