import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessForm, ModulesForm, OwnerInvite, PlanForm } from "@/components/platform/academy-forms";
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

// One academy: owner, plan and usage, modules, and access (Prompt 21).
export default async function AcademyPage({ params }: PageProps<"/platform/academies/[id]">) {
  await requirePlatformPage();
  const { id } = await params;
  const a = await academyDetail(id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const plans = await allPlans();
  const limits: [string, number, number | null | undefined][] = [
    ["Students", a.usage.students, a.plan?.maxStudents],
    ["Staff", a.usage.staff, a.plan?.maxStaff],
    ["Branches", a.usage.branches, a.plan?.maxBranches],
  ];
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
          <CardHeader title="Plan" />
          <PlanForm
            academyId={a.id}
            plan={a.subscription?.planCode ?? ""}
            status={a.subscription?.status ?? "trial"}
            plans={plans.map((p) => ({ value: p.code, label: `${p.name} · ${formatPaise(p.pricePaise)}${p.isActive ? "" : " (not offered)"}` }))}
            statuses={SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: words(s) }))}
          />
          <dl className="mt-4 divide-y divide-neutral-100 text-body">
            {limits.map(([label, n, max]) => (
              <div key={label} className="flex min-h-11 items-center justify-between">
                <dt>{label}</dt>
                <dd className={max !== null && max !== undefined && n > max ? "text-danger-600" : ""}>
                  {n} {max === null || max === undefined ? "· no limit" : `of ${max}`}
                </dd>
              </div>
            ))}
          </dl>
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
