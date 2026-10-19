import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { CollectDrawer, CollectSearch } from "@/components/payments/collect-form";
import { METHOD_LABEL } from "@/modules/payments/labels";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, formatDate, isIsoDate, timeIn, todayIn } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { SheetPayment } from "@/modules/payments/repo";
import { type CollectionSheet, type CollectScreen, collectionSheet, collectScreen, collectTarget, myReceiptsToday } from "@/modules/payments/service";
import { listBranches } from "@/modules/tenancy/repo";

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

// docs/04 "The daily reconciliation screen": one sheet per branch, counted by the day recorded. Collecting
// without payments:read shows only your own receipts today. ?collect=1[&student=][&invoice=] opens the drawer.
export default async function CollectionPage({ searchParams }: PageProps<"/finance/collections">) {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const canRead = allows(ctx, "payments:read");
  const canCollect = allows(ctx, "fees:collect");
  if (!canRead && !canCollect) return <Gate permission="payments:read">{null}</Gate>;
  const sp = await searchParams;
  const param = (k: string) => (typeof sp[k] === "string" ? sp[k] : undefined);
  const today = todayIn(session.tenant.timezone);
  const asked = param("day");
  const day = canRead && asked && isIsoDate(asked) && asked <= today ? asked : today;
  // The page without the drawer: where closing it goes back to.
  const kept = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && !COLLECT_PARAMS.includes(k) ? [[k, v]] : [])));
  const closeHref = `/finance/collections${kept.size ? `?${kept}` : ""}`;
  const collectHref = `${closeHref}${kept.size ? "&" : "?"}collect=1`;
  const [student, invoice] = [param("student"), param("invoice")];
  const chosen = await selectedBranchIds(session);

  const d = await withTenant(session.tenant.id, async (tx) => {
    const branches = canRead ? (await listBranches(tx)).filter((b) => (chosen.length ? chosen.includes(b.id) : true)) : [];
    const sheets = await Promise.all(branches.map((b) => collectionSheet(tx, ctx, { branchId: b.id, day })));
    const mine = canRead ? [] : await myReceiptsToday(tx, { ...ctx, branchIds: chosen });
    let drawer: { screen: CollectScreen; preselect: string[] } | "search" | null = null;
    if (canCollect && param("collect") === "1") {
      const t = await collectTarget(tx, ctx, { ...(student ? { studentId: student } : {}), ...(invoice ? { invoiceId: invoice } : {}) });
      drawer = t ? { screen: await collectScreen(tx, ctx, t.memberId, t.branchId), preselect: t.preselect } : "search";
    }
    return { sheets, mine, drawer };
  }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { sheets, mine, drawer } = d;
  const nothing = sheets.every((s) => !s.payments.length && !s.refunds.rows.length);
  const collect = (className: string, size?: "lg") => (
    <Button size={size ?? "default"} className={className} nativeButton={false} render={<Link href={collectHref} scroll={false} />}>
      Collect payment
    </Button>
  );

  return (
    <Gate permission={canRead ? "payments:read" : "fees:collect"}>
      <PageHeader title="Collections" actions={canCollect ? collect("hidden md:inline-flex") : undefined}>
        <p className="mt-1 text-caption text-muted-foreground">{day === today ? `Today, ${formatDate(day)}` : formatDate(day)}</p>
      </PageHeader>
      {!canRead ? (
        <Card>
          <CardHeader title="Your receipts today" />
          {mine.length ? <Receipts payments={mine} timeZone={session.tenant.timezone} /> : <EmptyState title="No receipts yet today" hint="What you collect today shows here." action="Collect payment" href={collectHref} />}
        </Card>
      ) : (
        <>
          <nav aria-label="Day" className="mb-5 flex items-center gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href={`/finance/collections?day=${addDays(day, -1)}`} />}>
              ← {formatDate(addDays(day, -1))}
            </Button>
            {day < today ? (
              <>
                <Button variant="outline" nativeButton={false} render={<Link href={`/finance/collections?day=${addDays(day, 1)}`} />}>
                  {formatDate(addDays(day, 1))} →
                </Button>
                <Button variant="ghost" nativeButton={false} render={<Link href="/finance/collections" />}>
                  Today
                </Button>
              </>
            ) : null}
          </nav>
          {nothing && sheets.length <= 1 ? (
            <Card>
              <EmptyState
                title="No payments on this day"
                hint="Payments recorded on a day show here, by method and by collector, with the cash to deposit."
                {...(canCollect && day === today ? { action: "Collect payment", href: collectHref } : {})}
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-5">
              {sheets.map((s) => (
                <Sheet key={s.branch.id} s={s} titled={sheets.length > 1} timeZone={session.tenant.timezone} />
              ))}
            </div>
          )}
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
