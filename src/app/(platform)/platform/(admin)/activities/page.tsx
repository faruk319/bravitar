import { ActivityRow, BillingSettingsForm } from "@/components/platform/academy-forms";
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

// What each activity costs a branch per month (placeholders until you set
// them), and how billing works (agreed 2026-09-30).
export default async function ActivitiesPage() {
  await requirePlatformPage();
  const { activities, settings } = await activityCatalog();
  return (
    <>
      <h1 className="mb-4 text-display">Activities</h1>
      <Card className="mb-5 divide-y divide-neutral-100">
        {activities.map((a) => (
          <ActivityRow
            key={a.key}
            statuses={STATUS}
            a={{
              key: a.key,
              name: a.name,
              description: a.description ?? "",
              price: rupeesText(a.pricePaise),
              status: a.status,
              used: `${a.branches} ${a.branches === 1 ? "branch" : "branches"}`,
              changes: a.changes.map((c) => `${formatPaise(c.oldPaise)} → ${formatPaise(c.newPaise)} on ${formatDate(c.changedAt)}${c.reason ? ` (${c.reason})` : ""}`),
            }}
          />
        ))}
      </Card>
      <Card>
        <CardHeader title="Billing" />
        <BillingSettingsForm
          v={{ graceDays: settings.graceDays, trialDays: settings.trialDays, taxPercent: String(settings.taxRateBp / 100), gstin: settings.gstin ?? "", howToPay: settings.howToPay ?? "" }}
        />
      </Card>
    </>
  );
}
