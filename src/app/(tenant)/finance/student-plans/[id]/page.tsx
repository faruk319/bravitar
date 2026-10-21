import Link from "next/link";
import { notFound } from "next/navigation";
import { EnrollmentActions, PlanSelect } from "@/components/enrollments/student-batches";
import type { DueItem } from "@/components/fees/still-due";
import { ExtendPack } from "@/components/fees/extend-pack";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows, can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { formatDate, todayIn } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { batchChoices } from "@/modules/enrollments/service";
import { installmentsDue, planChoices, studentPlanDetail } from "@/modules/fees/service";

const PER: Record<string, string> = { monthly: "month", quarterly: "quarter", half_yearly: "6 months", yearly: "year" };
const STATUS_WORD = { active: "Active", paused: "Paused", left: "Ended", transferred: "Moved" } as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function StudentPlanPage({ params }: PageProps<"/finance/student-plans/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const canManage = can(ctx, "batches", "enrollments:manage");
  const o = await withTenant(session.tenant.id, async (tx) => {
    const d = await studentPlanDetail(tx, ctx, id);
    const manage = canManage && (d.row.status === "active" || d.row.status === "paused");
    return {
      d,
      choices: manage ? (await batchChoices(tx, ctx)).map((b) => ({ id: b.id, label: `${b.name} · ${b.schedule}` })) : [],
      plans: manage ? await planChoices(tx, ctx) : [],
      due: manage ? await installmentsDue(tx, ctx, d.row.studentId) : [],
    };
  }).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!o) notFound();
  const { d, due: dueAll } = o;
  const r = d.row;
  const today = todayIn(session.tenant.timezone);
  const manage = canManage && (r.status === "active" || r.status === "paused");
  const due: DueItem[] = dueAll.filter((i) => i.enrollmentId === r.enrollmentId).map((i) => ({ invoiceId: i.invoiceId, enrollmentId: i.enrollmentId, description: i.description, number: i.number, dueDate: i.dueDate, amount: formatPaise(i.totalPaise - i.paidPaise), voidable: i.voidable }));
  const canInvoice = allows(ctx, "invoices:manage");
  const canCollect = allows(ctx, "fees:collect");
  const totals: [string, bigint][] = [["Billed", d.totals.billedPaise], ["Paid", d.totals.paidPaise], ["Outstanding", d.totals.outstandingPaise], ["Advance", d.totals.advancePaise]];

  return (
    <Gate permission="invoices:read">
      <PageHeader
        title={r.studentName}
        entity
        actions={
          <>
            {canInvoice ? (
              <Button variant="outline" nativeButton={false} render={<Link href={`/finance/invoices?create=1&student=${r.studentId}`} />}>
                Create invoice
              </Button>
            ) : null}
            {canCollect ? (
              <Button nativeButton={false} render={<Link href={`/finance/collections?collect=1&student=${r.studentId}`} />}>
                Collect payment
              </Button>
            ) : null}
          </>
        }
      >
        <p className="text-caption text-muted-foreground">
          {r.programName} · {r.batchName}
        </p>
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {totals.map(([label, paise]) => (
              <Card key={label}>
                <p className="text-caption text-muted-foreground">{label}</p>
                <Money paise={paise} className="text-heading font-medium" />
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader title="Billing" />
            {d.timeline.length ? (
              <ul className="divide-y divide-neutral-100">
                {d.timeline.map((t) => (
                  <li key={t.invoiceId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <Link href={`/finance/invoices/${t.invoiceId}`} className="font-medium text-accent-600 hover:underline">
                        {t.label}
                      </Link>
                      <p className="text-caption text-muted-foreground">
                        {t.number ?? "Draft"} · Due {formatDate(t.dueDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-right tabular-nums">
                        <Money paise={t.paidPaise} /> / <Money paise={t.amountPaise} />
                      </span>
                      <InvoiceStatus status={t.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-caption text-muted-foreground">Nothing billed yet.</p>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Plan" />
          <dl className="divide-y divide-neutral-100">
            <Fact label="Student">
              <Link href={`/students/${r.studentId}`} className="text-accent-600 hover:underline">
                {r.studentName}
              </Link>
            </Fact>
            <Fact label="Status">{STATUS_WORD[r.status]}</Fact>
            <Fact label="Plan">{r.planName}</Fact>
            <Fact label="Fee">
              <Money paise={r.amountPaise} />
              {r.kind === "recurring" ? ` / ${PER[r.cycle] ?? r.cycle}` : ""}
            </Fact>
            {d.afterDiscountPaise !== r.amountPaise ? (
              <Fact label="After discount">
                <Money paise={d.afterDiscountPaise} />
              </Fact>
            ) : null}
            {d.discounts.map((g) => (
              <Fact key={g.id} label="Discount">
                {g.name}
              </Fact>
            ))}
            <Fact label="Starts">{formatDate(r.startDate)}</Fact>
            {r.endDate ? <Fact label="Ends">{formatDate(r.endDate)}</Fact> : null}
            <Fact label="Payer">{r.payerName || "—"}</Fact>
            <Fact label="Next bill">{r.packText ?? (r.nextBill ? formatDate(r.nextBill) : "—")}</Fact>
          </dl>
          {canInvoice && d.pack ? (
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <ExtendPack id={d.pack.id} validUntil={d.pack.validUntil} />
            </div>
          ) : null}
          {manage ? (
            <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3">
              {o.plans.length ? <PlanSelect enrollmentId={r.enrollmentId} current={{ id: r.planId, name: r.planName }} plans={o.plans} /> : null}
              <EnrollmentActions enrollment={{ id: r.enrollmentId, status: r.status, batchId: r.batchId, startDate: r.startDate }} choices={o.choices} today={today} due={due} />
            </div>
          ) : null}
        </Card>
      </div>
    </Gate>
  );
}
