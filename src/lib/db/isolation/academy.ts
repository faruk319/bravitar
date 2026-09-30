import { platformDb } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { activityPlans } from "@/modules/billing/schema";
import { type CreatedTenant, createTenantWithDefaults, type NewTenantInput } from "@/modules/tenancy/service";

// Test-only. Academies on a hidden plan with no limits, so tests that aren't
// about plans don't depend on the catalog's editable numbers.
// deleteTenantsCompletely removes the plans after the academies.
const plans = new Map<string, Promise<string>>(); // activity -> this file's plan

async function insertPlan(activityKey: string): Promise<string> {
  const id = uuidv7();
  await platformDb.insert(activityPlans).values({ id, activityKey, name: `Test ${id}`, pricePaise: 0n, isOffered: false });
  return id;
}

export function testAcademy(input: NewTenantInput): Promise<CreatedTenant> {
  const activityKey = input.verticalPreset ?? "general";
  const plan = plans.get(activityKey) ?? insertPlan(activityKey);
  plans.set(activityKey, plan);
  return plan.then((planId) => createTenantWithDefaults({ actorType: "system" }, { ...input, planId }));
}

export async function takeTestPlans(): Promise<string[]> {
  const ids = await Promise.all(plans.values());
  plans.clear();
  return ids;
}
