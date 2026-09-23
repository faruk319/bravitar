import { PageHeader } from "@/components/page-header";
import { SignOutButton } from "@/components/shell/sign-out";
import { Card } from "@/components/ui/card";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { getStaff, listRoles, staffRoleIds } from "@/modules/staff/repo";
import { getOwnTenant } from "@/modules/tenancy/repo";

export default async function MePage() {
  const session = await requireStaffPage();
  const { staff, tenant, roleNames } = await withTenant(session.tenant.id, async (tx) => {
    const [staff, tenant, roles, mine] = await Promise.all([getStaff(tx, session.actor.id), getOwnTenant(tx), listRoles(tx), staffRoleIds(tx, session.actor.id)]);
    return { staff, tenant, roleNames: roles.filter((r) => mine.includes(r.id)).map((r) => r.name) };
  });
  const rows: [string, string][] = [
    ["Name", staff?.fullName ?? ""],
    ["Email", staff?.email ?? ""],
    ["Academy", tenant?.name ?? ""],
    ["Roles", roleNames.join(", ") || (session.isOwner ? "Owner" : "—")],
  ];
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="My account" />
      <Card className="p-0 md:p-0">
      <dl className="divide-y divide-neutral-100">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-h-14 items-center justify-between gap-4 px-4">
            <dt className="text-label text-muted-foreground">{k}</dt>
            <dd className="truncate text-body">{v}</dd>
          </div>
        ))}
      </dl>
      </Card>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </div>
  );
}
