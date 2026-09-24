import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { CollectForm, type DueInvoice, FamilySearch } from "@/components/payments/collect-form";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { getInvoice } from "@/modules/fees/repo";
import { collectScreen } from "@/modules/payments/service";
import { requireStudent } from "@/modules/students/service";

// docs/07 §7.4. Opened from a student (their family and branch), from an
// invoice (just that one ticked), or from the menu (find the family first).
export default async function CollectPage({ searchParams }: PageProps<"/payments/new">) {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "fees:collect")) return <Gate permission="fees:collect">{null}</Gate>;
  const sp = await searchParams;
  const param = (k: string) => (typeof sp[k] === "string" ? sp[k] : undefined);
  const [invoiceId, studentId] = [param("invoice"), param("student")];

  const found = await withTenant(session.tenant.id, async (tx) => {
    let who: { householdId: string; branchId: string; preselect?: string[] } | undefined;
    if (invoiceId) {
      const inv = await getInvoice(tx, ctx.branchIds, invoiceId);
      if (!inv) throw new NotFoundError("Invoice");
      who = { householdId: inv.householdId, branchId: inv.branchId, preselect: [inv.id] };
    } else if (studentId) {
      const s = await requireStudent(tx, ctx, studentId);
      who = { householdId: s.householdId, branchId: s.branchId };
    }
    return who ? { who, screen: await collectScreen(tx, ctx, who.householdId, who.branchId) } : undefined;
  }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  if (!found) {
    return (
      <Gate permission="fees:collect">
        <PageHeader title="Collect payment" />
        <Card>
          <FamilySearch />
        </Card>
      </Gate>
    );
  }

  const { who, screen } = found;
  const due: DueInvoice[] = screen.account.open.map((i) => ({ id: i.id, number: i.number ?? "", dueDate: i.dueDate, balance: String(i.balancePaise), overdue: i.dueDate < screen.today }));
  const preselect = who.preselect?.filter((id) => due.some((d) => d.id === id));
  return (
    <Gate permission="fees:collect">
      <PageHeader title="Collect payment">
        <p className="mt-1 text-caption text-muted-foreground">
          {screen.householdName}
          {session.branchIds.length !== 1 ? ` · ${screen.branchName}` : ""} ·{" "}
          <Link href="/payments/new" className="text-accent-600 hover:underline">
            Another family
          </Link>
        </p>
      </PageHeader>
      <Card>
        <CollectForm
          householdId={who.householdId}
          branchId={who.branchId}
          due={due}
          advance={String(screen.account.advancePaise)}
          {...(preselect?.length ? { preselect } : {})}
          today={screen.today}
          earliest={screen.earliest}
        />
      </Card>
    </Gate>
  );
}
