import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { NewRole } from "@/components/staff/role-editor";
import { StaffTabs } from "@/components/staff/staff-tabs";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { roleViews } from "@/modules/staff/service";

export default async function RolesPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "staff:read")) return <Gate permission="staff:read">{null}</Gate>;
  const roles = await withTenant(session.tenant.id, (tx) => roleViews(tx, ctx));
  const editable = roles.filter((r) => !r.isSystem).map((r) => ({ id: r.id, label: r.name }));

  return (
    <Gate permission="staff:read">
      <PageHeader title="{staff.many}" actions={allows(ctx, "staff:manage") ? <NewRole roles={editable} /> : undefined} />
      <StaffTabs active="roles" />
      <Card className="overflow-hidden p-0 md:p-0">
        <ul className="divide-y divide-neutral-100">
          {roles.map((r) => (
            <li key={r.id}>
              <Link href={`/staff/roles/${r.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-neutral-50 md:px-5">
                <span>
                  <span className="block text-body font-medium text-neutral-900">{r.name}</span>
                  <span className="block text-caption text-muted-foreground">{r.isSystem ? "Everything, always" : `${r.keys.length} permissions`}</span>
                </span>
                <span className="text-label text-muted-foreground tabular-nums">{r.holders} staff</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </Gate>
  );
}
