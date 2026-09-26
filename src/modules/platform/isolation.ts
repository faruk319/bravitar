import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createBranch } from "@/modules/tenancy/repo";
import { branchSubscriptions } from "./schema";

// The suite ensures the platform plans exist before fixtures run.
export const platformFixtures: IsolationFixtures = {
  branch_subscriptions: async (tx, tenantId) => {
    const branch = await createBranch(tx, { tenantId, name: `Iso branch ${uuidv7()}` });
    return tx.insert(branchSubscriptions).values({ id: uuidv7(), tenantId, branchId: branch.id, planCode: "starter", status: "trial" });
  },
};
