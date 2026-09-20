import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { tenantSubscriptions } from "./schema";

// The suite ensures the platform plans exist before fixtures run.
export const platformFixtures: IsolationFixtures = {
  tenant_subscriptions: (tx, tenantId) =>
    tx.insert(tenantSubscriptions).values({ id: uuidv7(), tenantId, planCode: "starter", status: "trial" }),
};
