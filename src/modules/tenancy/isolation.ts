import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { createBranch, createResource } from "./repo";

// One entry per tenant-scoped table in this module. The isolation suite fails
// if a table in the catalog has no fixture.
export const tenancyFixtures: IsolationFixtures = {
  branches: (tx, tenantId) => createBranch(tx, { tenantId, name: `Branch ${tenantId.slice(0, 8)}` }),
  resources: async (tx, tenantId) => {
    const branch = await createBranch(tx, { tenantId, name: `Branch for resource ${tenantId.slice(0, 8)}` });
    return createResource(tx, { tenantId, branchId: branch.id, name: "Hall", capacity: 30 });
  },
};
