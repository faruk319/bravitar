import { SignOutButton } from "@/components/shell/sign-out";
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
    <div className="mx-auto max-w-md p-4">
      <h1 className="mb-4 text-display">Me</h1>
      <dl className="divide-y divide-border rounded-xl border border-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-h-14 items-center justify-between gap-4 px-4">
            <dt className="text-label text-muted-foreground">{k}</dt>
            <dd className="truncate text-body">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </div>
  );
}
