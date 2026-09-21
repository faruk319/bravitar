import { cookies } from "next/headers";
import { AdminShell } from "@/components/shell/admin-shell";
import { CoachShell } from "@/components/shell/coach-shell";
import { TenantProvider } from "@/components/shell/tenant-provider";
import { BRANCH_COOKIE } from "@/lib/auth/branch-cookie";
import { coachNavFor, navFor } from "@/lib/auth/nav";
import { requireStaffPage } from "@/lib/auth/server";
import { shellFor } from "@/lib/auth/shell";
import { withTenant } from "@/lib/db/with-tenant";
import { resolveLabels } from "@/lib/tenant/labels";
import { getOwnTenant, listBranches } from "@/modules/tenancy/repo";

export default async function TenantLayout({ children }: LayoutProps<"/">) {
  const session = await requireStaffPage();
  const { tenant, branches } = await withTenant(session.tenant.id, async (tx) => ({ tenant: await getOwnTenant(tx), branches: await listBranches(tx) }));
  if (!tenant) throw new Error("tenant missing");

  const allowed = session.branchIds.length ? branches.filter((b) => session.branchIds.includes(b.id)) : branches;
  const wanted = (await cookies()).get(BRANCH_COOKIE)?.value;
  const currentBranchId = wanted && allowed.some((b) => b.id === wanted) ? wanted : "all";
  const labels = resolveLabels({ verticalPreset: tenant.verticalPreset, labelOverrides: tenant.labelOverrides });
  const shell = shellFor(session);

  return (
    <TenantProvider value={{ session, tenantName: tenant.name, labels, branches: allowed.map((b) => ({ id: b.id, name: b.name })), currentBranchId }}>
      {shell === "coach" ? <CoachShell items={coachNavFor(session)}>{children}</CoachShell> : <AdminShell groups={navFor(session)}>{children}</AdminShell>}
    </TenantProvider>
  );
}
