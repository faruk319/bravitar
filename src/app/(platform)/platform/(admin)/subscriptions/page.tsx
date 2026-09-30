import Link from "next/link";
import { ActivityIcon } from "@/components/activity-icon";
import { selectClass } from "@/components/fees/plan-editor";
import { perCycle, subscriptionState } from "@/components/platform/billing-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePlatformPage } from "@/lib/auth/server";
import { todayIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "@/modules/billing/schema";
import { allSubscriptions, effectivePrice } from "@/modules/billing/service";

const STATUS_LABEL: Record<SubscriptionStatus, string> = { trial: "On trial", active: "Active", paused: "Paused", cancelled: "Ended" };
const isStatus = (s: unknown): s is SubscriptionStatus => typeof s === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(s);

// Every academy's branch modules (agreed 2026-09-30): live ones unless a status
// is picked, one module or all.
export default async function SubscriptionsPage({ searchParams }: PageProps<"/platform/subscriptions">) {
  await requirePlatformPage();
  const q = await searchParams;
  const status = isStatus(q.status) ? q.status : undefined;
  const activityKey = typeof q.module === "string" && q.module ? q.module : undefined;
  const { rows, modules } = await allSubscriptions({ status, activityKey });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-display">Subscriptions</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="status" aria-label="Status" defaultValue={status ?? ""} className={selectClass}>
            <option value="">All live</option>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select name="module" aria-label="Module" defaultValue={activityKey ?? ""} className={selectClass}>
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      </div>
      <Card className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[48rem] text-body">
          <thead>
            <tr className="bg-neutral-50 text-left text-caption uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Academy</th>
              <th className="py-2 font-medium">Module</th>
              <th className="py-2 font-medium">Plan</th>
              <th className="py-2 font-medium">Price</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-neutral-100">
                <td className="px-4 py-2">
                  <Link href={`/platform/academies/${s.tenantId}`} className="font-medium text-neutral-900 hover:underline">
                    {s.academyName}
                  </Link>
                  <span className="block text-caption text-muted-foreground">{s.branchName}</span>
                </td>
                <td className="py-2">
                  <ActivityIcon name={s.activityIcon} className="mr-1.5 inline size-4 align-[-2px] text-accent-600" />
                  {s.activityName}
                </td>
                <td className="py-2">{s.planName}</td>
                <td className="py-2 tabular-nums">{perCycle(effectivePrice(s, todayIn(s.timezone)), s.billingInterval)}</td>
                <td className={cn("px-4 py-2", s.status === "paused" && "text-danger-600", s.status === "cancelled" && "text-muted-foreground")}>{subscriptionState(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length ? null : <p className="p-6 text-center text-body text-muted-foreground">No subscription matches.</p>}
      </Card>
    </>
  );
}
