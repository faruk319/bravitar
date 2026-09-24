import { EmptyState } from "@/components/empty-state";
import { AddDiscount, DiscountToggle } from "@/components/fees/discounts";
import { PlanEditor, type PlanForm } from "@/components/fees/plan-editor";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { PlanRow } from "@/modules/fees/repo";
import { feeSetup } from "@/modules/fees/service";

const EVERY: Record<string, string> = { monthly: "Every month", quarterly: "Every 3 months", half_yearly: "Every 6 months", yearly: "Every year" };

function howBilled(p: PlanRow): string {
  if (p.kind === "recurring") return EVERY[p.billingCycle] ?? p.billingCycle;
  if (p.kind === "term") return `Term · ${p.metadata.installments?.length ?? 0} installments`;
  return p.kind === "package" ? "Package (later)" : "One-time";
}

const formOf = (p: PlanRow): PlanForm => ({
  id: p.id,
  name: p.name,
  programId: p.programId,
  kind: p.kind,
  billingCycle: p.billingCycle,
  amountPaise: String(p.amountPaise),
  admissionFeePaise: String(p.admissionFeePaise),
  billingDay: p.billingDay,
  graceDays: p.graceDays,
  taxRateBp: p.taxRateBp,
  isActive: p.isActive,
  installments: p.metadata.installments ?? [],
});

export default async function FeePlansPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "fee_plans:manage")) return <Gate permission="fee_plans:manage">{null}</Gate>;
  const { plans, discounts, programs } = await withTenant(session.tenant.id, (tx) => feeSetup(tx, ctx));
  const programChoices = programs.map((p) => ({ id: p.id, name: p.name }));

  return (
    <Gate permission="fee_plans:manage">
      <PageHeader
        title="Fee plans"
        actions={
          <PlanEditor programs={programChoices} trigger={<Button />}>
            Add plan
          </PlanEditor>
        }
      />
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden p-0 md:p-0">
          {plans.length ? (
            <ul className="divide-y divide-neutral-100">
              {plans.map((p) => (
                <li key={p.id}>
                  <PlanEditor plan={formOf(p)} programs={programChoices} trigger={<button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-neutral-50 md:px-5" />}>
                    <span className="min-w-0">
                      <span className={cn("block text-body font-medium", p.isActive ? "text-neutral-900" : "text-neutral-500")}>{p.name}</span>
                      <span className="block text-caption text-muted-foreground">
                        {[howBilled(p), p.programName, `${p.students} ${p.students === 1 ? "student" : "students"}`, p.isActive ? "" : "Archived"].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Money paise={p.amountPaise} className="text-body font-medium" />
                  </PlanEditor>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No fee plans yet" hint="Monthly, quarterly or term fees." />
          )}
        </Card>
        <Card>
          <CardHeader title="Discounts" action={<AddDiscount />} />
          {discounts.length ? (
            <ul className="divide-y divide-neutral-100">
              {discounts.map((d) => (
                <li key={d.id} className="flex min-h-12 items-center justify-between gap-3">
                  <span className={cn("text-body", !d.isActive && "text-neutral-500")}>
                    {d.name} <span className="text-caption text-muted-foreground">· {d.kind === "percent" ? `${d.value}%` : formatPaise(BigInt(d.value))}</span>
                  </span>
                  <DiscountToggle id={d.id} isActive={d.isActive} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">None yet.</p>
          )}
        </Card>
      </div>
    </Gate>
  );
}
