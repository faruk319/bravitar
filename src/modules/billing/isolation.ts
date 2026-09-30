import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createBranch } from "@/modules/tenancy/repo";
import { activitySubscriptions } from "./schema";

// Written through the platform role (PLATFORM_WRITTEN in the registry).
export const billingFixtures: IsolationFixtures = {
  activity_subscriptions: async (tx, tenantId) => {
    const branch = await createBranch(tx, { tenantId, name: `Iso branch ${uuidv7()}` });
    return tx.insert(activitySubscriptions).values({ id: uuidv7(), tenantId, branchId: branch.id, activityKey: "general", status: "active", pricePaise: 0n, anchorDay: 1, periodStart: "2026-10-01", periodEnd: "2026-10-01" });
  },
};
