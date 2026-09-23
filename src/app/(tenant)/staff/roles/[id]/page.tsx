import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { type PermissionGroup, RoleEditor } from "@/components/staff/role-editor";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { MODULES, PERMISSION_KEYS, PERMISSIONS } from "@/lib/auth/permissions";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { roleViews } from "@/modules/staff/service";

const MODULE_LABEL: Record<(typeof MODULES)[number], string> = {
  core: "Staff & settings",
  students: "Students",
  enquiries: "Enquiries",
  batches: "Batches & classes",
  attendance: "Attendance",
  fees: "Fees",
  messaging: "Messages",
  reports: "Reports",
};

export default async function RolePage({ params }: PageProps<"/staff/roles/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "staff:read")) return <Gate permission="staff:read">{null}</Gate>;
  const role = (await withTenant(session.tenant.id, (tx) => roleViews(tx, ctx))).find((r) => r.id === id);
  if (!role) notFound();
  const groups: PermissionGroup[] = MODULES.map((m) => ({
    module: m,
    label: MODULE_LABEL[m],
    off: m !== "core" && ctx.modules[m] === false,
    options: PERMISSION_KEYS.filter((k) => PERMISSIONS[k].module === m).map((k) => ({ id: k, label: PERMISSIONS[k].description, hint: k })),
  })).filter((g) => g.options.length);

  return (
    <Gate permission="staff:read">
      <PageHeader title={role.name} crumbs={[{ label: "Roles", href: "/staff/roles" }]}>
        <p className="text-caption text-muted-foreground">{role.holders} staff hold this role</p>
      </PageHeader>
      <Card className="max-w-3xl">
        {role.isSystem ? (
          <p className="text-body text-muted-foreground">The owner can do everything. This role can&apos;t be changed.</p>
        ) : allows(ctx, "staff:manage") ? (
          <RoleEditor roleId={role.id} name={role.name} keys={role.keys} holders={role.holders} groups={groups} />
        ) : (
          <ul className="flex flex-col gap-1 text-body">
            {role.keys.map((k) => (
              <li key={k}>{PERMISSIONS[k as keyof typeof PERMISSIONS]?.description ?? k}</li>
            ))}
          </ul>
        )}
      </Card>
    </Gate>
  );
}
