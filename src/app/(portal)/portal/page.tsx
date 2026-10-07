import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Card } from "@/components/ui/card";
import { requireGuardianPage } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { billedToMe, childrenOf } from "@/modules/portal/service";

// The first child's page; the others are one tap away on it.
// With no children left, the invoices billed to this person stay readable.
export default async function PortalHome() {
  const s = await requireGuardianPage();
  const g = { tenantId: s.tenant.id, guardianId: s.actor.id };
  const { first, billed } = await withTenant(s.tenant.id, async (tx) => ({
    first: (await childrenOf(tx, g))[0],
    billed: await billedToMe(tx, g).catch((e: unknown) => {
      if (e instanceof NotFoundError) return [];
      throw e;
    }),
  }));
  if (first) redirect(`/portal/${first.id}`);
  if (!billed.length)
    return (
      <Card>
        <EmptyState title="No children here yet" hint="Ask the academy to add your child with this phone number." />
      </Card>
    );
  return (
    <>
      <h1 className="mb-4 text-display">Invoices</h1>
      <Card className="p-0 md:p-0">
        <ul className="divide-y divide-neutral-100">
          {billed.map((i) => (
            <li key={i.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block text-body tabular-nums">{i.number}</span>
                <span className="block text-caption text-muted-foreground">
                  {formatDate(i.dueDate)} · {i.status === "paid" ? "paid" : "due"}
                </span>
              </span>
              <Money paise={i.status === "paid" ? i.totalPaise : i.totalPaise - i.paidPaise} className="shrink-0 text-body font-medium" />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
