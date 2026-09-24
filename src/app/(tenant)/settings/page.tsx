import { FeeSettings } from "@/components/fees/fee-settings";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Placeholder } from "@/components/shell/placeholder";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { getOwnTenant } from "@/modules/tenancy/repo";

export default async function SettingsPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "settings:manage")) return <Gate permission="settings:manage">{null}</Gate>;
  const tenant = await withTenant(session.tenant.id, getOwnTenant);
  return (
    <Gate permission="settings:manage">
      <PageHeader title="Settings" />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {ctx.modules.fees ? (
          <Card>
            <CardHeader title="Fees" />
            <FeeSettings gstin={tenant?.gstin ?? null} proration={tenant?.proration ?? "full"} />
          </Card>
        ) : null}
        <Placeholder title="Academy settings" hint="Name, branches, labels and integrations." action="Edit academy" />
      </div>
    </Gate>
  );
}
