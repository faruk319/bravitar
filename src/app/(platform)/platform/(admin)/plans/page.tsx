import { PlanRow } from "@/components/platform/academy-forms";
import { Card } from "@/components/ui/card";
import { requirePlatformPage } from "@/lib/auth/server";
import { rupeesText } from "@/lib/money/format";
import { allPlans } from "@/modules/platform/academies";

// Plan prices and limits (placeholders until you set them); a blank limit means none.
export default async function PlansPage() {
  await requirePlatformPage();
  const plans = await allPlans();
  return (
    <>
      <h1 className="mb-4 text-display">Plans</h1>
      <Card className="divide-y divide-neutral-100">
        {plans.map((p) => (
          <PlanRow key={p.code} p={{ code: p.code, name: p.name, price: rupeesText(p.pricePaise), maxStudents: p.maxStudents, maxStaff: p.maxStaff, maxBranches: p.maxBranches, isActive: p.isActive }} />
        ))}
      </Card>
    </>
  );
}
