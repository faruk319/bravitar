import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, type Option } from "@/components/filter-bar";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PagingFooter } from "@/components/paging-footer";
import { CollectDrawer, CollectSearch } from "@/components/payments/collect-form";
import { PaymentTable } from "@/components/payments/payment-table";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { formatDate, timeIn } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { withQuery } from "@/lib/url-query";
import { cn } from "@/lib/utils";
import { DISPLAY_LABEL, METHOD_LABEL, PAYMENT_DISPLAYS } from "@/modules/payments/labels";
import type { SheetPayment } from "@/modules/payments/repo";
import { PAYMENT_METHODS } from "@/modules/payments/schema";
import { COLLECTION_PERIODS, type CollectionPeriod, type CollectionSheet, type CollectScreen, collectionList, collectionParams, collectScreen, collectTarget, parseCollectionQuery } from "@/modules/payments/service";

const PATH = "/finance/collections";
const PERIOD_WORD: Record<CollectionPeriod, string> = { today: "Today", week: "This week", month: "This month", all: "All" };
const METHODS: Option[] = PAYMENT_METHODS.map((id) => ({ id, name: METHOD_LABEL[id] }));
const STATUSES: Option[] = PAYMENT_DISPLAYS.map((id) => ({ id, name: DISPLAY_LABEL[id] }));
const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount", label: "Highest amount" },
];
// Shown when a period holds nothing and no filter is on.
const EMPTY: Record<CollectionPeriod, [string, string]> = {
  today: ["No payments today", "Payments recorded today show here."],
  week: ["No payments this week", "Payments recorded this week show here."],
  month: ["No payments this month", "Payments recorded this month show here."],
  all: ["No payments yet", "Every payment you record shows here."],
};

const receipts = (n: number) => `${n} ${n === 1 ? "receipt" : "receipts"}`;

function Line({ label, note, paise, strong }: { label: string; note?: string; paise: bigint; strong?: boolean }) {
  return (
    <div className={cn("flex min-h-11 items-center justify-between gap-3", strong && "text-heading")}>
      <dt>
        {label}
        {note ? <span className="text-caption text-muted-foreground"> · {note}</span> : null}
      </dt>
      <dd>
        <Money paise={paise} showPaise={paise % 100n !== 0n} />
      </dd>
    </div>
  );
}

function Receipts({ payments, timeZone }: { payments: SheetPayment[]; timeZone: string }) {
  return (
    <ul className="mt-1 divide-y divide-neutral-100">
      {payments.map((p) => {
        const cancelled = p.status === "cancelled";
        const facts = [timeIn(timeZone, p.createdAt), METHOD_LABEL[p.method], p.collectorName, p.receivedOn !== p.recordedOn ? `received ${formatDate(p.receivedOn)}` : "", cancelled ? `cancelled: ${p.cancelReason}` : ""];
        return (
          <li key={p.id}>
            <Link href={`/finance/collections/${p.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-neutral-50">
              <span className="min-w-0">
                <span className="block truncate text-body text-neutral-900">
                  {p.billToName} <span className="text-caption tabular-nums text-muted-foreground">{p.receiptNumber}</span>
                </span>
                <span className={cn("block truncate text-caption", cancelled ? "text-danger-700" : "text-muted-foreground")}>{facts.filter(Boolean).join(" · ")}</span>
              </span>
              <Money paise={p.amountPaise} className={cn("shrink-0 text-body font-medium", cancelled && "text-muted-foreground line-through")} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Sheet({ s, titled, timeZone }: { s: CollectionSheet; titled: boolean; timeZone: string }) {
  const empty = !s.payments.length && !s.refunds.rows.length;
  return (
    <Card>
      {titled ? <CardHeader title={s.branch.name} /> : null}
      {empty ? (
        <p className="text-body text-muted-foreground">No payments recorded on this day.</p>
      ) : (
        <>
          <dl className="divide-y divide-neutral-100 text-body">
            {s.byMethod.map((m) => (
              <Line key={m.method} label={METHOD_LABEL[m.method]} note={receipts(m.count)} paise={m.totalPaise} />
            ))}
            <Line label="Total" note={receipts(s.total.count)} paise={s.total.totalPaise} strong />
            {s.refunds.byMethod.map((m) => (
              <Line key={`r-${m.method}`} label={`Refunded, ${METHOD_LABEL[m.method].toLowerCase()}`} note={`${m.count}`} paise={-m.totalPaise} />
            ))}
            <Line label="Cash in hand to deposit" paise={s.cashInHandPaise} strong />
          </dl>
          {s.byCollector.length ? (
            <p className="mt-2 text-caption text-muted-foreground">
              Collected by{" "}
              {s.byCollector.map((c, i) => (
                <span key={c.staffId ?? "online"}>
                  {i ? ", " : ""}
                  {c.name} <Money paise={c.totalPaise} />
                </span>
              ))}
            </p>
          ) : null}

          <h3 className="mt-5 text-label text-muted-foreground">Receipts</h3>
          <Receipts payments={s.payments} timeZone={timeZone} />

          {s.refunds.rows.length ? (
            <>
              <h3 className="mt-5 text-label text-muted-foreground">Refunds</h3>
              <ul className="mt-1 divide-y divide-neutral-100">
                {s.refunds.rows.map((r) => (
                  <li key={r.id}>
                    <Link href={`/finance/collections/${r.paymentId}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-neutral-50">
                      <span className="min-w-0">
                        <span className="block truncate text-body text-neutral-900">
                          {r.billToName} <span className="text-caption tabular-nums text-muted-foreground">{r.receiptNumber}</span>
                        </span>
                        <span className="block truncate text-caption text-muted-foreground">
                          {timeIn(timeZone, r.refundedAt)} · {METHOD_LABEL[r.method]} · {r.reason}
                        </span>
                      </span>
                      <Money paise={-r.amountPaise} className="shrink-0 text-body" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}

const COLLECT_PARAMS = ["collect", "student", "invoice"];

// Every payment in one table by the day it was recorded, with the day's sheet above it on Today or a one-day range.
// Collecting without payments:read shows only your own receipts today. ?collect=1[&student=][&invoice=] opens the drawer.
export default async function CollectionPage({ searchParams }: PageProps<"/finance/collections">) {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const canRead = allows(ctx, "payments:read");
  const canCollect = allows(ctx, "fees:collect");
  if (!canRead && !canCollect) return <Gate permission="payments:read">{null}</Gate>;
  const sp = await searchParams;
  const param = (k: string) => (typeof sp[k] === "string" ? sp[k] : undefined);
  // The page without the drawer: where closing it goes back to.
  const kept = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && !COLLECT_PARAMS.includes(k) ? [[k, v]] : [])));
  const closeHref = withQuery(PATH, kept);
  const collectHref = withQuery(PATH, new URLSearchParams([...kept, ["collect", "1"]]));
  const [student, invoice] = [param("student"), param("invoice")];
  const chosen = await selectedBranchIds(session);

  const d = await withTenant(session.tenant.id, async (tx) => {
    const list = await collectionList(tx, { ...ctx, branchIds: chosen }, parseCollectionQuery(sp));
    let drawer: { screen: CollectScreen; preselect: string[] } | "search" | null = null;
    if (canCollect && param("collect") === "1") {
      const t = await collectTarget(tx, ctx, { ...(student ? { studentId: student } : {}), ...(invoice ? { invoiceId: invoice } : {}) });
      drawer = t ? { screen: await collectScreen(tx, ctx, t.memberId, t.branchId), preselect: t.preselect } : "search";
    }
    return { list, drawer };
  }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { list, drawer } = d;
  const { applied, counts, own } = list;
  const timeZone = session.tenant.timezone;
  const pageHref = (p: number) => withQuery(PATH, collectionParams(applied, p));
  const filtered = Boolean(applied.q || applied.method || applied.collectorId || applied.programId || applied.status || applied.from || applied.to);
  const [emptyTitle, emptyHint] = filtered ? ["No payment matches", "Change the filters or clear them."] : EMPTY[applied.period];
  // A day with nothing on it shows the table's empty state alone.
  const sheets = list.sheets?.some((s) => s.payments.length || s.refunds.rows.length) ? list.sheets : [];
  const collect = (className: string, size?: "lg") => (
    <Button size={size ?? "default"} className={className} nativeButton={false} render={<Link href={collectHref} scroll={false} />}>
      Collect payment
    </Button>
  );
  const csv =
    !own && allows(ctx, "reports:export") ? (
      <Button variant="outline" nativeButton={false} render={<a href={withQuery("/api/reports/collections", collectionParams(applied))} download />}>
        <Download data-icon="inline-start" /> Download CSV
      </Button>
    ) : null;

  return (
    <Gate permission={canRead ? "payments:read" : "fees:collect"}>
      <PageHeader
        title="Collections"
        actions={
          csv || canCollect ? (
            <>
              {csv}
              {canCollect ? collect("hidden md:inline-flex") : null}
            </>
          ) : undefined
        }
      />
      {own ? (
        <Card className="overflow-hidden p-0 md:p-0">
          <div className="px-4 pt-4 md:px-5 md:pt-5">
            <CardHeader title="Your receipts today" />
          </div>
          {list.rows.length ? (
            <>
              <div className="px-4 pb-2 md:px-5">
                <Receipts payments={list.rows} timeZone={timeZone} />
              </div>
              <PagingFooter page={list.page} pageSize={list.pageSize} shown={list.rows.length} matched={list.matched} href={pageHref} />
            </>
          ) : (
            <EmptyState title="No receipts yet today" hint="What you collect today shows here." action="Collect payment" href={collectHref} />
          )}
        </Card>
      ) : (
        <>
          <SegmentedTabs
            label="Period"
            items={COLLECTION_PERIODS.map((period) => ({
              href: withQuery(PATH, collectionParams({ ...applied, period })),
              label: `${PERIOD_WORD[period]} · ${counts[period]}`,
              active: period === applied.period,
            }))}
          />
          {sheets.length ? (
            <div className="mb-5 flex flex-col gap-5">
              {sheets.map((s) => (
                <Sheet key={s.branch.id} s={s} titled={sheets.length > 1} timeZone={timeZone} />
              ))}
            </div>
          ) : null}
          <Card className="overflow-hidden p-0 md:p-0">
            <div className="p-4 md:p-5">
              <Suspense>
                <FilterBar
                  path={PATH}
                  search={{ placeholder: "Receipt, student, payer or reference" }}
                  selects={[
                    { name: "method", label: "Method", all: "All methods", options: METHODS },
                    { name: "collector", label: "Collected by", all: "Anyone", options: list.options.collectors },
                    { name: "program", label: "Program", all: "All programs", options: list.options.programs },
                    { name: "status", label: "Status", all: "All statuses", options: STATUSES },
                  ]}
                  dates={[
                    { name: "from", label: "From" },
                    { name: "to", label: "To" },
                  ]}
                  sorts={SORTS}
                />
              </Suspense>
            </div>
            {list.rows.length === 0 ? (
              <EmptyState title={emptyTitle} hint={emptyHint} {...(canCollect && !filtered && applied.period === "today" ? { action: "Collect payment", href: collectHref } : {})} />
            ) : (
              <>
                <PaymentTable rows={list.rows} timeZone={timeZone} />
                <PagingFooter page={list.page} pageSize={list.pageSize} shown={list.rows.length} matched={list.matched} href={pageHref} />
              </>
            )}
          </Card>
        </>
      )}
      {canCollect ? <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-neutral-100 bg-background px-4 py-3 md:hidden">{collect("w-full", "lg")}</div> : null}
      {drawer === "search" ? (
        <CollectSearch closeHref={closeHref} />
      ) : drawer ? (
        <CollectDrawer key={`${drawer.screen.memberId}:${drawer.screen.branchId}:${drawer.preselect.join()}`} screen={drawer.screen} preselect={drawer.preselect} closeHref={closeHref} />
      ) : null}
    </Gate>
  );
}
