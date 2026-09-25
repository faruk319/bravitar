import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { METHOD_LABEL } from "@/modules/payments/labels";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, formatDate, isIsoDate, timeIn, todayIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { type CollectionSheet, collectionSheet } from "@/modules/payments/service";
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
          <ul className="mt-1 divide-y divide-neutral-100">
            {s.payments.map((p) => {
              const cancelled = p.status === "cancelled";
              const facts = [timeIn(timeZone, p.createdAt), METHOD_LABEL[p.method], p.collectorName, p.receivedOn !== p.recordedOn ? `received ${formatDate(p.receivedOn)}` : "", cancelled ? `cancelled: ${p.cancelReason}` : ""];
              return (
                <li key={p.id}>
                  <Link href={`/payments/${p.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-neutral-50">
                    <span className="min-w-0">
                      <span className="block truncate text-body text-neutral-900">
                        {p.householdName} <span className="text-caption tabular-nums text-muted-foreground">{p.receiptNumber}</span>
                      </span>
                      <span className={cn("block truncate text-caption", cancelled ? "text-danger-600" : "text-muted-foreground")}>{facts.filter(Boolean).join(" · ")}</span>
                    </span>
                    <Money paise={p.amountPaise} className={cn("shrink-0 text-body font-medium", cancelled && "text-muted-foreground line-through")} />
                  </Link>
                </li>
              );
            })}
          </ul>

          {s.refunds.rows.length ? (
            <>
              <h3 className="mt-5 text-label text-muted-foreground">Refunds</h3>
              <ul className="mt-1 divide-y divide-neutral-100">
                {s.refunds.rows.map((r) => (
                  <li key={r.id}>
                    <Link href={`/payments/${r.paymentId}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-neutral-50">
                      <span className="min-w-0">
                        <span className="block truncate text-body text-neutral-900">
                          {r.householdName} <span className="text-caption tabular-nums text-muted-foreground">{r.receiptNumber}</span>
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

// docs/04 "The daily reconciliation screen": what the owner checks against the
// cash drawer at closing time. One sheet per branch; counted by the day recorded.
export default async function CollectionPage({ searchParams }: PageProps<"/payments">) {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "payments:read")) return <Gate permission="payments:read">{null}</Gate>;
  const asked = (await searchParams).day;
  const today = todayIn(session.tenant.timezone);
  const day = typeof asked === "string" && isIsoDate(asked) && asked <= today ? asked : today;
  const chosen = await selectedBranchIds(session);
  const sheets = await withTenant(session.tenant.id, async (tx) => {
    const branches = (await listBranches(tx)).filter((b) => (chosen.length ? chosen.includes(b.id) : true));
    return Promise.all(branches.map((b) => collectionSheet(tx, ctx, { branchId: b.id, day })));
  });
  const canCollect = allows(ctx, "fees:collect");
  const nothing = sheets.every((s) => !s.payments.length && !s.refunds.rows.length);

  return (
    <Gate permission="payments:read">
      <PageHeader
        title="Collection"
        actions={
          canCollect ? (
            <Button nativeButton={false} render={<Link href="/payments/new" />}>
              Collect payment
            </Button>
          ) : undefined
        }
      >
        <p className="mt-1 text-caption text-muted-foreground">{day === today ? `Today, ${formatDate(day)}` : formatDate(day)}</p>
      </PageHeader>
      <nav aria-label="Day" className="mb-5 flex items-center gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href={`/payments?day=${addDays(day, -1)}`} />}>
          ← {formatDate(addDays(day, -1))}
        </Button>
        {day < today ? (
          <>
            <Button variant="outline" nativeButton={false} render={<Link href={`/payments?day=${addDays(day, 1)}`} />}>
              {formatDate(addDays(day, 1))} →
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/payments" />}>
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
            {...(canCollect && day === today ? { action: "Collect payment", href: "/payments/new" } : {})}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {sheets.map((s) => (
            <Sheet key={s.branch.id} s={s} titled={sheets.length > 1} timeZone={session.tenant.timezone} />
          ))}
        </div>
      )}
    </Gate>
  );
}
