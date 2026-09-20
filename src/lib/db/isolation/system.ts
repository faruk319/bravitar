import { writeAudit } from "@/lib/db/audit";
import type { IsolationFixtures } from "./types";

export const systemFixtures: IsolationFixtures = {
  audit_log: (tx, tenantId) => writeAudit(tx, { action: "test.isolation", actorType: "system", tenantId }),
};
