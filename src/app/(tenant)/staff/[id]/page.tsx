import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { StaffManage } from "@/components/staff/staff-manage";
import { StaffStatusPill } from "@/components/staff/staff-status";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { roleViews, staffDirectory } from "@/modules/staff/service";
import { listBranches } from "@/modules/tenancy/repo";

export default async function StaffMemberPage({ params }: PageProps<"/staff/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "staff:read")) return <Gate permission="staff:read">{null}</Gate>;
  const { staff, roles, branches } = await withTenant(session.tenant.id, async (tx) => ({ staff: await staffDirectory(tx, ctx), roles: await roleViews(tx, ctx), branches: await listBranches(tx) }));
  const s = staff.find((x) => x.id === id);
  if (!s) notFound();
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <Gate permission="staff:read">
      <PageHeader title={s.fullName} crumbs={[{ label: "{staff.many}", href: "/staff" }]} />
      <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
        <Card className="flex flex-col items-center text-center">
          <Avatar name={s.fullName} size="lg" />
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {s.isOwner ? <span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-label text-accent-600">Owner</span> : null}
            <StaffStatusPill status={s.status} />
          </div>
          <dl className="mt-4 w-full divide-y divide-neutral-100 text-left">
            {[
              ["Email", s.email],
              ["Phone", s.phone ?? "—"],
              ["Branches", s.branchIds.length ? s.branchIds.map((b) => branchName.get(b)).join(", ") : "All branches"],
              ["Last seen", s.lastLoginAt ? formatDate(s.lastLoginAt) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex min-h-12 items-center justify-between gap-3">
                <dt className="text-label text-muted-foreground">{k}</dt>
                <dd className="truncate text-body">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Access" />
          {allows(ctx, "staff:manage") ? (
            <StaffManage
              staffId={s.id}
              name={s.fullName}
              active={s.isActive}
              roles={roles.filter((r) => !r.isSystem).map((r) => ({ id: r.id, label: r.name, hint: `${r.keys.length} permissions` }))}
              branches={branches.map((b) => ({ id: b.id, label: b.name }))}
              roleIds={s.roleIds}
              branchIds={s.branchIds}
            />
          ) : (
            <p className="text-body text-muted-foreground">{s.roleIds.map((r) => roles.find((x) => x.id === r)?.name).join(", ") || "No role"}</p>
          )}
        </Card>
      </div>
    </Gate>
  );
}
