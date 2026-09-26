import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/ui/card";
import { requireGuardianPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { childrenOf } from "@/modules/portal/service";

// The first child's page; the others are one tap away on it.
export default async function PortalHome() {
  const s = await requireGuardianPage();
  const [first] = await withTenant(s.tenant.id, (tx) => childrenOf(tx, { tenantId: s.tenant.id, guardianId: s.actor.id }));
  if (first) redirect(`/portal/${first.id}`);
  return (
    <Card>
      <EmptyState title="No children here yet" hint="Ask the academy to add your child with this phone number." />
    </Card>
  );
}
