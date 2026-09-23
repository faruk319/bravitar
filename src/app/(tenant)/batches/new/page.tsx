import { BatchForm } from "@/components/batches/batch-form";
import { Gate } from "@/components/shell/gate";
import { PageTitle } from "@/components/shell/placeholder";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { todayIn } from "@/lib/dates";
import { listPrograms } from "@/modules/batches/repo";
import { coachChoices } from "@/modules/batches/service";
import { getOwnTenant, listResources } from "@/modules/tenancy/repo";

export default async function NewBatchPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const allowed = can(ctx, "batches", "batches:manage");
  const data = allowed
    ? await withTenant(session.tenant.id, async (tx) => ({
        programs: (await listPrograms(tx, { activeOnly: true })).map((p) => ({ id: p.id, name: p.name })),
        coaches: await coachChoices(tx, ctx),
        rooms: (await listResources(tx)).map((r) => ({ id: r.id, name: r.name, branchId: r.branchId })),
        today: todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata"),
      }))
    : undefined;
  return (
    <Gate permission="batches:manage">
      <PageTitle>{"Add {batch.one}"}</PageTitle>
      {data ? <BatchForm {...data} canAddProgram={can(ctx, "batches", "programs:manage")} /> : null}
    </Gate>
  );
}
