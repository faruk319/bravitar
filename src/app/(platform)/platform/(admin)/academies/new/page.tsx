import Link from "next/link";
import { NewAcademyForm } from "@/components/platform/academy-forms";
import { Card } from "@/components/ui/card";
import { requirePlatformPage } from "@/lib/auth/server";
import { getEnv } from "@/lib/env";
import { formatPaise } from "@/lib/money/format";
import { VERTICAL_PRESETS } from "@/lib/tenant/labels";
import { allPlans } from "@/modules/billing/service";

// A new academy: its first branch with its first activity on trial, roles and
// owner, then the owner's link.
export default async function NewAcademyPage() {
  await requirePlatformPage();
  const plans = (await allPlans()).map((p) => ({ value: p.id, activityKey: p.activityKey, label: `${p.name} · ${formatPaise(p.pricePaise)}${p.isOffered ? "" : " (not offered)"}` }));
  return (
    <>
      <Link href="/platform" className="text-label text-accent-600 hover:underline">
        ← Academies
      </Link>
      <h1 className="mt-1 mb-4 text-display">New academy</h1>
      <Card>
        <NewAcademyForm domain={getEnv().APP_DOMAIN} plans={plans} types={VERTICAL_PRESETS.map((t) => ({ value: t, label: t[0]?.toUpperCase() + t.slice(1) }))} />
      </Card>
    </>
  );
}
