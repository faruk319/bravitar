import { Banknote, TriangleAlert, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { ActivityIcon } from "@/components/activity-icon";
import { METHOD_LABEL, perCycle, priceNote } from "@/components/billing-text";
import { AcademyLink, Section } from "@/components/platform/sections";
import { StatCard } from "@/components/stat-card";
import { requirePlatformPage } from "@/lib/auth/server";
import { formatDate, formatDayMonth, todayIn } from "@/lib/dates";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { ListedSubscription } from "@/modules/billing/repo";
import { billingOverview } from "@/modules/billing/service";

// One branch module of one academy, with something on the right.
function ModuleRow({ s, right }: { s: ListedSubscription; right: ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <span className="text-body">
        <AcademyLink id={s.tenantId} name={s.academyName} />
        <span className="block text-caption text-muted-foreground">
          <ActivityIcon name={s.activityIcon} className="mr-1 inline size-3.5 align-[-2px]" />
          {s.activityName} at {s.branchName} · {s.planName}
        </span>
      </span>
      <span className="shrink-0 text-right text-caption">{right}</span>
    </li>
  );
}

// Bravitar's own billing across academies (agreed 2026-10-01): what they owe,
// who waits to pay, trials ending this week, special prices and payments.
export default async function BillingPage() {
  await requirePlatformPage();
  const o = await billingOverview();
  return (
    <>
      <h1 className="mb-4 text-display">Billing</h1>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label={`Overdue · ${o.overdueCount} ${o.overdueCount === 1 ? "bill" : "bills"}`} value={formatPaise(o.overduePaise)} icon={TriangleAlert} href="#owed" />
        <StatCard label="Still owed" value={formatPaise(o.owedPaise)} icon={Wallet} href="#owed" />
        <StatCard label="Received this month" value={formatPaise(o.receivedPaise)} icon={Banknote} href="#payments" />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section id="owed" title="Bills owed" empty={!o.owed.length}>
          {o.owed.map((b) => (
            <li key={b.id} className="flex items-start justify-between gap-3 py-3">
              <span className="text-body">
                <AcademyLink id={b.tenantId} name={b.academyName} />
                <span className="block text-caption text-muted-foreground">
                  {b.description} · {b.number}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 whitespace-nowrap">
                <span className="tabular-nums">{formatPaise(b.balance)}</span>
                <span className={cn("text-caption", b.overdue ? "text-danger-600" : "text-muted-foreground")}>{b.overdue ? `Overdue since ${formatDayMonth(b.dueOn)}` : `Due ${formatDayMonth(b.dueOn)}`}</span>
              </span>
            </li>
          ))}
        </Section>
        <Section id="waiting" title="Waiting for payment" empty={!o.waiting.length}>
          {o.waiting.map((s) => (
            <ModuleRow key={s.id} s={s} right={<span className="tabular-nums">{perCycle(s.pricePaise, s.billingInterval)}</span>} />
          ))}
        </Section>
        <Section id="trials" title="Trials ending this week" empty={!o.endingTrials.length}>
          {o.endingTrials.map((s) => (
            <ModuleRow key={s.id} s={s} right={`Ends ${formatDate(s.periodEnd)}`} />
          ))}
        </Section>
        <Section id="prices" title="Special prices" empty={!o.specialPrices.length}>
          {o.specialPrices.map((s) => (
            <ModuleRow key={s.id} s={s} right={priceNote(s, todayIn(s.timezone))} />
          ))}
        </Section>
        <Section id="payments" title="Recent payments" empty={!o.payments.length}>
          {o.payments.map((p) => (
            <li key={p.id} className={cn("flex items-start justify-between gap-3 py-3", p.cancelledAt && "text-muted-foreground")}>
              <span className="text-body">
                <AcademyLink id={p.tenantId} name={p.academyName} />
                <span className="block text-caption text-muted-foreground">
                  {p.activityName} at {p.branchName} · {formatDate(p.receivedOn)} · {METHOD_LABEL[p.method]}
                  {p.reference ? ` · ${p.reference}` : ""}
                  {p.cancelledAt ? ` · Cancelled: ${p.cancelReason}` : ""}
                </span>
              </span>
              <span className={cn("shrink-0 tabular-nums", p.cancelledAt && "line-through")}>{formatPaise(p.amountPaise)}</span>
            </li>
          ))}
        </Section>
      </div>
    </>
  );
}
