import { ActivityRow, AddPlanRow, BillingSettingsForm, PlanRow } from "@/components/platform/academy-forms";
import { Card, CardHeader } from "@/components/ui/card";
import { requirePlatformPage } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { formatPaise, rupeesText } from "@/lib/money/format";
import { activityCatalog } from "@/modules/billing/service";

const STATUS = [
  { value: "active", label: "Offered" },
  { value: "coming_soon", label: "Coming soon" },
  { value: "retired", label: "Not offered" },
];

const limitText = (n: number | null) => (n === null ? "" : String(n));

// Each activity and its plans: prices and limits are placeholders until you
// set them (agreed 2026-09-30). Then how billing works.
export default async function ActivitiesPage() {
  await requirePlatformPage();
  const { activities, settings } = await activityCatalog();
  return (
    <>
      <h1 className="mb-4 text-display">Activities</h1>
      <div className="mb-5 flex flex-col gap-4">
        {activities.map((a) => (
          <Card key={a.key}>
            <ActivityRow statuses={STATUS} a={{ key: a.key, name: a.name, description: a.description ?? "", status: a.status }} />
            <div className="divide-y divide-neutral-100 border-t border-neutral-100">
              {a.plans.map((p) => (
                <PlanRow
                  key={p.id}
                  p={{
                    id: p.id,
                    name: p.name,
                    price: rupeesText(p.pricePaise),
                    maxStudents: limitText(p.maxStudents),
                    maxStaff: limitText(p.maxStaff),
                    isOffered: p.isOffered,
                    used: `${p.branches} ${p.branches === 1 ? "branch" : "branches"}`,
                    changes: p.changes.map((c) => `${formatPaise(c.oldPaise)} → ${formatPaise(c.newPaise)} on ${formatDate(c.changedAt)}${c.reason ? ` (${c.reason})` : ""}`),
                  }}
                />
              ))}
              <AddPlanRow activityKey={a.key} />
            </div>
          </Card>
        ))}
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
