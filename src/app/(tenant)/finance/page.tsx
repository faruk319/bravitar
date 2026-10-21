import { CalendarClock, CalendarRange, FileClock, IndianRupee, PiggyBank, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { type Alert, AttentionRequired } from "@/components/dashboard/attention-required";
import { RevenueOverview } from "@/components/dashboard/revenue-overview";
import { StatusBar } from "@/components/fees/status-bar";
import { PageHeader } from "@/components/page-header";
import { type BarItem, BarList } from "@/components/reports/bars";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { addDays } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { formatCount, formatPaise } from "@/lib/money/format";
import type { Paise } from "@/lib/money/paise";
import { liveModules } from "@/modules/billing/repo";
import { METHOD_LABEL } from "@/modules/payments/labels";
import type { PaymentMethod } from "@/modules/payments/schema";
import { financeOverview, type RevenueReport } from "@/modules/reports/service";

const DAYS = [7, 30, 90] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayTick = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""}`;
const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;
const bars = (items: { key: string; label: string; note?: string; paise: Paise; href?: string }[]): BarItem[] => {
  const max = items.reduce((m, i) => (i.paise > m ? i.paise : m), 0n);
  return items.map((i) => ({ key: i.key, label: i.label, value: formatPaise(i.paise), fraction: max ? Number((i.paise * 1000n) / max) / 1000 : 0, ...(i.note ? { note: i.note } : {}), ...(i.href ? { href: i.href } : {}) }));
};

// By program, or by activity when the academy runs two or more; collected when the viewer may see it, else billed.
function revenueBars(r: RevenueReport, byCollected: boolean, activityName: Map<string, string> | null): BarItem[] {
  const pick = (x: { collectedPaise: Paise; billedPaise: Paise }) => (byCollected ? x.collectedPaise : x.billedPaise);
  const groups = new Map<string, { key: string; label: string; note?: string; paise: Paise }>();
  for (const row of r.rows) {
    const key = activityName ? row.activityKey : `${row.programId ?? ""}|${row.batchId ?? ""}`;
    const label = activityName ? (activityName.get(row.activityKey) ?? row.programName) : row.programName;
    const g = groups.get(key) ?? { key, label, ...(!activityName && row.batchName ? { note: row.batchName } : {}), paise: 0n };
    groups.set(key, { ...g, paise: g.paise + pick(row) });
  }
  const items = [...groups.values()].filter((g) => g.paise > 0n).sort((a, b) => Number(b.paise - a.paise));
  if (byCollected && r.advancePaise > 0n) items.push({ key: "advance", label: "Advance", paise: r.advancePaise });
  return bars(items);
}

// Each block renders only when it is in the payload: that is the permission gate.
export default async function FinanceOverviewPage({ searchParams }: PageProps<"/finance">) {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  const canPay = allows(ctx, "payments:read");
  if (!canPay && !allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const sp = await searchParams;
  const days = DAYS.find((d) => String(d) === sp.days) ?? 30;
  const [o, modules] = await withTenant(session.tenant.id, async (tx) => [await financeOverview(tx, ctx, { days }), await liveModules(tx)] as const);
  const { collected: c, owed, advance, revenue, mix, drafts } = o;
  const weekEnd = addDays(o.today, 6);
  const dueSoonHref = `/finance/invoices?status=open&dueFrom=${o.today}&dueTo=${weekEnd}`;
  const canCollect = allows(ctx, "fees:collect");
  const collect = (className: string, size?: "lg") => (
    <Button size={size ?? "default"} className={className} nativeButton={false} render={<Link href="/finance/collections?collect=1" />}>
      Collect payment
    </Button>
  );

  // % vs yesterday; nothing yesterday means no chip.
  const vsYesterday = c && c.yesterday.total > 0n ? Math.round((Number(c.today.total - c.yesterday.total) / Number(c.yesterday.total)) * 100) : null;
  const refundNote = (p: Paise, receipts: number) => (p > 0n ? `Refunded ${formatPaise(p)}` : count(receipts, "receipt", "receipts"));
  const monthOutstanding = revenue?.rows.reduce((n, r) => n + r.outstandingPaise, 0n);
  const activityName = modules.length > 1 ? new Map(modules.map((m) => [m.key, m.name])) : null;
  const revenueItems = revenue ? revenueBars(revenue, canPay, activityName) : [];

  const alerts: Alert[] = [];
  if (owed) {
    alerts.push({ key: "overdue", n: owed.overdueCount, text: `${count(owed.overdueCount, "invoice", "invoices")} overdue · ${formatPaise(owed.overduePaise)}`, href: "/finance/invoices?status=overdue", icon: TriangleAlert, tone: "danger" });
    alerts.push({ key: "week", n: owed.dueSoonCount, text: `${count(owed.dueSoonCount, "invoice", "invoices")} due this week · ${formatPaise(owed.dueSoonPaise)}`, href: dueSoonHref, icon: CalendarClock, tone: "warning" });
  }
  if (drafts) alerts.push({ key: "drafts", n: drafts.count, text: `${count(drafts.count, "draft", "drafts")} to issue · ${formatPaise(drafts.total)}`, href: "/finance/invoices?status=draft", icon: FileClock, tone: "muted" });
  if (owed) alerts.push({ key: "part", n: owed.partPaidCount, text: `${count(owed.partPaidCount, "invoice", "invoices")} part paid`, href: "/finance/invoices?status=part_paid", icon: Wallet, tone: "warning" });
  if (advance) alerts.push({ key: "advance", n: advance.owing, text: `${count(advance.owing, "payer holds", "payers hold")} advance while owing`, href: "/finance/discounts?tab=advance&owes=1", icon: PiggyBank, tone: "warning" });

  return (
    <Gate permission={canPay ? "payments:read" : "invoices:read"}>
      <PageHeader title="Finance" actions={canCollect ? collect("hidden md:inline-flex") : undefined} />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {c ? <StatCard label="Today's collection" value={formatPaise(c.today.total)} trend={vsYesterday} note={vsYesterday === null ? refundNote(c.refundsToday, c.today.count) : c.refundsToday > 0n ? `Refunded ${formatPaise(c.refundsToday)}` : "vs yesterday"} icon={IndianRupee} href="/finance/collections" /> : null}
          {c ? <StatCard label="This month" value={formatPaise(c.month.total)} note={refundNote(c.refundsMonth, c.month.count)} icon={CalendarRange} href="/finance/collections?period=month" /> : null}
          {owed ? <StatCard label="Outstanding" value={formatPaise(owed.owedPaise)} note={count(owed.invoices, "invoice", "invoices")} icon={Wallet} href="/finance/invoices?status=open" /> : null}
          {owed ? <StatCard label="Overdue" value={formatPaise(owed.overduePaise)} note={count(owed.overdueCount, "invoice", "invoices")} icon={TriangleAlert} href="/finance/invoices?status=overdue" /> : null}
          {owed ? <StatCard label="Due in 7 days" value={formatPaise(owed.dueSoonPaise)} note={count(owed.dueSoonCount, "invoice", "invoices")} icon={CalendarClock} href={dueSoonHref} /> : null}
          {advance ? <StatCard label="Advance held" value={formatPaise(advance.paise)} note={count(advance.payers, "payer", "payers")} icon={PiggyBank} href="/finance/discounts?tab=advance" /> : null}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {c ? (
            <Card className="lg:col-span-2">
              <CardHeader title="Collection trend" />
              <SegmentedTabs label="Days shown" items={DAYS.map((d) => ({ href: `/finance?days=${d}`, label: `${d} days`, active: d === days }))} />
              <RevenueOverview bars={c.trend.map((t) => ({ label: dayTick(t.key), totalPaise: t.totalPaise }))} label={`Collection, last ${days} days`} />
            </Card>
          ) : null}
          {c || monthOutstanding !== undefined ? (
            <Card>
              <CardHeader title="Collected vs outstanding" />
              <BarList
                items={bars([
                  ...(c ? [{ key: "collected", label: "Collected this month", paise: c.month.total, href: "/finance/collections?period=month" }] : []),
                  ...(owed && monthOutstanding !== undefined ? [{ key: "outstanding", label: "Outstanding on this month's invoices", paise: monthOutstanding, href: `/finance/invoices?status=open&issuedFrom=${revenue?.from}&issuedTo=${revenue?.to}` }] : []),
                ])}
              />
            </Card>
          ) : null}
          {revenue ? (
            <Card>
              <CardHeader title={activityName ? "Revenue by activity" : "Revenue by program"} />
              {revenueItems.length ? <BarList items={revenueItems} /> : <p className="text-body text-muted-foreground">Nothing this month yet.</p>}
            </Card>
          ) : null}
          {c ? (
            <Card>
              <CardHeader title="By method" />
              {c.byMethod.length ? (
                <BarList items={bars([...c.byMethod].sort((a, b) => Number(b.totalPaise - a.totalPaise)).map((m) => ({ key: m.key, label: METHOD_LABEL[m.key as PaymentMethod] ?? m.key, note: count(m.count, "receipt", "receipts"), paise: m.totalPaise })))} />
              ) : (
                <p className="text-body text-muted-foreground">Nothing this month yet.</p>
              )}
            </Card>
          ) : null}
          {mix ? (
            <Card>
              <CardHeader title="Fee status" />
              <StatusBar mix={mix} />
            </Card>
          ) : null}
          <AttentionRequired alerts={alerts} />
        </div>
      </div>
      {canCollect ? <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-neutral-100 bg-background px-4 py-3 md:hidden">{collect("w-full", "lg")}</div> : null}
    </Gate>
  );
}
