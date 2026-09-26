import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessForm, BranchPlanForm, ModulesForm, OwnerInvite } from "@/components/platform/academy-forms";
import { Card, CardHeader } from "@/components/ui/card";
import { MODULES } from "@/lib/auth/permissions";
import { requirePlatformPage } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { tenantOrigin } from "@/lib/tenant/origin";
import { academyDetail, allPlans } from "@/modules/platform/academies";
import { SUBSCRIPTION_STATUSES } from "@/modules/platform/schema";

const words = (s: string) => (s[0]?.toUpperCase() ?? "") + s.slice(1).replace("_", " ");
const STATUS_WORD: Record<string, string> = { trial: "Trial", active: "Active", past_due: "Past due", suspended: "Paused", cancelled: "Cancelled" };

// One academy: owner, plan and usage, modules, and access (Prompt 21).
export default async function AcademyPage({ params }: PageProps<"/platform/academies/[id]">) {
  await requirePlatformPage();
  const { id } = await params;
  const a = await academyDetail(id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const plans = await allPlans();
  return (
    <>
      <Link href="/platform" className="text-label text-accent-600 hover:underline">
        ← Academies
      </Link>
      <h1 className="mt-1 text-display">{a.name}</h1>
      <p className="mb-4 text-caption text-muted-foreground">
        <a href={tenantOrigin(a.slug)} className="hover:underline">
          {a.slug}
        </a>{" "}
        · {words(a.type)} · since {formatDate(a.createdAt)} · {a.status === "active" ? "● Active" : "⏸ Suspended"}
      </p>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Owner" />
          {a.owner ? (
            <>
              <p className="text-body">
                {a.owner.name} <span className="text-caption text-muted-foreground">· {a.owner.email}</span>
              </p>
              <p className="mb-3 text-caption text-muted-foreground">{a.owner.signedUp ? "Has set a password" : "Hasn't set a password yet"}</p>
              <OwnerInvite academyId={a.id} />
            </>
          ) : (
            <p className="text-body text-muted-foreground">No owner.</p>
          )}
        </Card>
        <Card>
          <CardHeader title={`Branches · ${formatPaise(a.monthlyPaise)}/month`} />
          <ul className="divide-y divide-neutral-100">
            {a.branches.map((b) => {
              const max = b.plan?.maxStudents;
              const sub = b.subscription;
              return (
                <li key={b.id} className="py-3">
                  <p className="text-body font-medium text-neutral-900">
                    {b.name}
                    {b.isDefault ? <span className="text-caption text-muted-foreground"> · first branch</span> : null}
                  </p>
                  <p className={max !== null && max !== undefined && b.students > max ? "text-caption text-danger-600" : "text-caption text-muted-foreground"}>
                    {b.students} {max === null || max === undefined ? "students · no limit" : `of ${max} students`} · {sub ? STATUS_WORD[sub.status] : "No plan"}
                    {sub?.status === "trial" && sub.trialEndsAt ? ` until ${formatDate(sub.trialEndsAt)}` : ""}
                  </p>
                  <div className="mt-2">
                    <BranchPlanForm
                      branchId={b.id}
                      plan={sub?.planCode ?? plans[0]?.code ?? ""}
                      status={sub?.status ?? "active"}
                      plans={plans.map((p) => ({ value: p.code, label: `${p.name} · ${formatPaise(p.pricePaise)}${p.isActive ? "" : " (not offered)"}` }))}
                      statuses={SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: STATUS_WORD[s] ?? words(s) }))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Modules" />
          <ModulesForm academyId={a.id} modules={MODULES.filter((m) => m !== "core").map((m) => ({ key: m, label: words(m), on: a.modules[m] !== false }))} />
        </Card>
        <Card>
          <CardHeader title="Access" />
          <p className="mb-3 text-caption text-muted-foreground">
            {a.status === "suspended" ? "Staff and parents can't sign in; nothing is deleted." : "Suspending ends every session and stops sign-in; nothing is deleted."}
          </p>
          <AccessForm key={a.status} academyId={a.id} suspended={a.status === "suspended"} />
        </Card>
      </div>
    </>
  );
}
