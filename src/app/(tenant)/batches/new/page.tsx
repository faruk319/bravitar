import { BatchForm } from "@/components/batches/batch-form";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { todayIn } from "@/lib/dates";
import { listPrograms } from "@/modules/batches/repo";
import { coachChoices } from "@/modules/batches/service";
import { liveModules } from "@/modules/billing/repo";
import { planChoices } from "@/modules/fees/service";
import { getOwnTenant, listResources } from "@/modules/tenancy/repo";

export default async function NewBatchPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const allowed = can(ctx, "batches", "batches:manage");
  const data = allowed
    ? await withTenant(session.tenant.id, async (tx) => ({
        programs: (await listPrograms(tx, { activeOnly: true })).map((p) => ({ id: p.id, name: p.name })),
        modules: await liveModules(tx).then((m) => (m.length > 1 ? m : [])),
        coaches: await coachChoices(tx, ctx),
        rooms: (await listResources(tx)).map((r) => ({ id: r.id, name: r.name, branchId: r.branchId })),
        plans: (await planChoices(tx, ctx)).map((p) => ({ id: p.id, name: p.name })),
        today: todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata"),
      }))
    : undefined;
  return (
    <Gate permission="batches:manage">
      <PageHeader title="Add {batch.one}" crumbs={[{ label: "Programs & {batch.many}", href: "/batches" }]} />
      {data ? (
        <Card className="max-w-2xl">
          <BatchForm {...data} canAddProgram={can(ctx, "batches", "programs:manage")} />
        </Card>
      ) : null}
    </Gate>
  );
}
