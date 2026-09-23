import { BatchTabs } from "@/components/batches/batch-tabs";
import { ProgramList } from "@/components/batches/program-list";
import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { programList } from "@/modules/batches/service";

export default async function ProgramsPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const programs = can(ctx, "batches", "batches:read") ? await withTenant(session.tenant.id, (tx) => programList(tx, ctx)) : [];
  return (
    <Gate permission="batches:read">
      <PageHeader title="Programs & {batch.many}" />
      <BatchTabs />
      <ProgramList programs={programs.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))} canManage={can(ctx, "batches", "programs:manage")} />
    </Gate>
  );
}
