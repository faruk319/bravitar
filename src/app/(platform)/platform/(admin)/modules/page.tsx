import { ActivityIcon } from "@/components/activity-icon";
import { ActivityRow, AddPlanRow, BillingSettingsForm, PlanRow } from "@/components/platform/academy-forms";
import { Card, CardHeader } from "@/components/ui/card";
import { ACTIVITY_ICONS, featuresOf } from "@/lib/activities";
import { MODULES } from "@/lib/auth/permissions";
import { requirePlatformPage } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { formatPaise, rupeesText } from "@/lib/money/format";
import { activityCatalog } from "@/modules/billing/service";

const STATUS = [
  { value: "active", label: "Offered" },
  { value: "coming_soon", label: "Coming soon" },
  { value: "retired", label: "Not offered" },
];

const words = (s: string) => (s[0]?.toUpperCase() ?? "") + s.slice(1).replaceAll("-", " ");
const ICONS = ACTIVITY_ICONS.map((i) => ({ value: i, label: words(i) }));
const SHARED = MODULES.filter((m) => m !== "core").map(words).join(" · ");

const limitText = (n: number | null) => (n === null ? "" : String(n));

// The modules Bravitar sells (agreed 2026-09-30), each with its own features
// and plans; prices and limits are placeholders until you set them. Then how
// billing works.
export default async function ModulesPage() {
  await requirePlatformPage();
  const { activities, settings } = await activityCatalog();
  return (
    <>
      <h1 className="text-display">Modules & pricing</h1>
      <p className="mb-4 text-caption text-muted-foreground">Every module includes {SHARED}.</p>
      <div className="mb-5 flex flex-col gap-4">
        {activities.map((a) => {
          const own = featuresOf(a.key);
          return (
            <Card key={a.key}>
              <p className="mb-2 flex items-center gap-2 text-heading text-neutral-900">
                <ActivityIcon name={a.icon} className="size-5 text-accent-600" />
                {a.name}
              </p>
              <ActivityRow statuses={STATUS} icons={ICONS} a={{ key: a.key, name: a.name, description: a.description ?? "", icon: a.icon, status: a.status }} />
              <p className="pb-3 text-caption text-muted-foreground">
                {own.length ? `Own features: ${own.map((f) => (f.ready ? f.name : `${f.name} (planned)`)).join(" · ")}` : "Shared features only"}
              </p>
              <div className="divide-y divide-neutral-100 border-t border-neutral-100">
                {a.plans.map((p) => (
                  <PlanRow
                    key={p.id}
                    p={{
                      id: p.id,
                      name: p.name,
                      price: rupeesText(p.pricePaise),
                      billingInterval: p.billingInterval,
                      maxStudents: limitText(p.maxStudents),
                      maxStaff: limitText(p.maxStaff),
                      isOffered: p.isOffered,
                      isDefault: p.isDefault,
                      used: `${p.branches} ${p.branches === 1 ? "branch" : "branches"}`,
                      changes: p.changes.map((c) => `${formatPaise(c.oldPaise)} → ${formatPaise(c.newPaise)} on ${formatDate(c.changedAt)}${c.reason ? ` (${c.reason})` : ""}`),
                    }}
                  />
                ))}
                <AddPlanRow activityKey={a.key} />
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Billing" />
        <BillingSettingsForm
          v={{ graceDays: settings.graceDays, trialDays: settings.trialDays, taxPercent: String(settings.taxRateBp / 100), gstin: settings.gstin ?? "", howToPay: settings.howToPay ?? "" }}
        />
      </Card>
    </>
  );
}
