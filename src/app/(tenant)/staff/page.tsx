import { Mail, UserCheck, Users, UserX } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { AddStaff } from "@/components/staff/add-staff";
import { StaffStatusPill } from "@/components/staff/staff-status";
import { StaffTabs } from "@/components/staff/staff-tabs";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { roleViews, type StaffRow, staffDirectory } from "@/modules/staff/service";
import { listBranches } from "@/modules/tenancy/repo";

// The KPI cards double as filters (?status=).
const FILTERS = {
  active: { label: "Active", match: (s: StaffRow) => s.status === "active" },
  pending: { label: "Pending invites", match: (s: StaffRow) => s.status === "invited" || s.status === "needs-link" },
  suspended: { label: "Suspended", match: (s: StaffRow) => s.status === "off" },
} as const;
const isFilter = (v: unknown): v is keyof typeof FILTERS => typeof v === "string" && Object.hasOwn(FILTERS, v);

const batchesText = (s: StaffRow) => (s.batches.length > 2 ? `${s.batches.slice(0, 2).map((b) => b.name).join(", ")} +${s.batches.length - 2}` : s.batches.map((b) => b.name).join(", ") || "—");

export default async function StaffPage({ searchParams }: PageProps<"/staff">) {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "staff:read")) return <Gate permission="staff:read">{null}</Gate>;
  const { staff: everyone, roles, branches } = await withTenant(session.tenant.id, async (tx) => ({ staff: await staffDirectory(tx, ctx), roles: await roleViews(tx, ctx), branches: await listBranches(tx) }));
  const asked = (await searchParams).status;
  const filter = isFilter(asked) ? FILTERS[asked] : undefined;
  const staff = filter ? everyone.filter(filter.match) : everyone;
  const count = (f: keyof typeof FILTERS) => everyone.filter(FILTERS[f].match).length;
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const assignable = roles.filter((r) => !r.isSystem).map((r) => ({ id: r.id, label: r.name }));
  const where = (ids: string[]) => (ids.length ? ids.map((id) => branchName.get(id)).join(", ") : "All branches");

  return (
    <Gate permission="staff:read">
      <PageHeader title="{staff.many}" actions={allows(ctx, "staff:manage") ? <AddStaff roles={assignable} branches={branches.map((b) => ({ id: b.id, label: b.name }))} /> : undefined} />
      <StaffTabs active="staff" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={everyone.length} icon={Users} href="/staff" />
        <StatCard label="Active" value={count("active")} icon={UserCheck} href="/staff?status=active" />
        <StatCard label="Pending invites" value={count("pending")} icon={Mail} href="/staff?status=pending" />
        <StatCard label="Suspended" value={count("suspended")} icon={UserX} href="/staff?status=suspended" />
      </div>
      {filter ? (
        <p className="mb-2 text-caption text-muted-foreground">
          {filter.label} ·{" "}
          <Link href="/staff" className="text-accent-600 hover:underline">
            Show all
          </Link>
        </p>
      ) : null}
      <Card className="overflow-hidden p-0 md:p-0">
        {staff.length ? null : <p className="px-4 py-4 text-body text-muted-foreground md:px-5">None.</p>}
        <table className={staff.length ? "hidden w-full md:table" : "hidden"}>
          <thead>
            <tr className="bg-neutral-50 text-left text-caption uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">Staff</th>
              <th className="py-2.5 font-medium">Role</th>
              <th className="py-2.5 font-medium">Batches</th>
              <th className="py-2.5 font-medium">Branches</th>
              <th className="py-2.5 font-medium">Status</th>
              <th className="px-5 py-2.5 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-5 py-2.5">
                  <Link href={`/staff/${s.id}`} className="flex items-center gap-3">
                    <Avatar name={s.fullName} />
                    <span>
                      <span className="block text-body font-medium text-neutral-900 hover:underline">{s.fullName}</span>
                      <span className="block text-caption text-muted-foreground">{s.email}</span>
                    </span>
                  </Link>
                </td>
                <td className="py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {s.isOwner ? (
                      <span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-label text-accent-600">Owner</span>
                    ) : (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-label">{(s.roleId && roleName.get(s.roleId)) || "No role"}</span>
                    )}
                  </span>
                </td>
                <td className="py-2.5 text-body text-muted-foreground">{batchesText(s)}</td>
                <td className="py-2.5 text-body text-muted-foreground">{where(s.branchIds)}</td>
                <td className="py-2.5">
                  <StaffStatusPill status={s.status} />
                </td>
                <td className="px-5 py-2.5 text-body text-muted-foreground">{s.lastLoginAt ? formatDate(s.lastLoginAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="divide-y divide-neutral-100 md:hidden">
          {staff.map((s) => (
            <li key={s.id}>
              <Link href={`/staff/${s.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <Avatar name={s.fullName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{s.fullName}</span>
                  <span className="block truncate text-caption text-muted-foreground">{s.isOwner ? "Owner" : (s.roleId && roleName.get(s.roleId)) || "No role"}</span>
                </span>
                <StaffStatusPill status={s.status} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </Gate>
  );
}
