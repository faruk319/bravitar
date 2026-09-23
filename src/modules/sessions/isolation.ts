import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createProgram, insertBatch } from "@/modules/batches/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { sessions } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 8);

export const sessionFixtures: IsolationFixtures = {
  sessions: async (tx, tenantId) => {
    const program = await createProgram(tx, { tenantId, name: `Program ${stamp()}` });
    const branch = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
    const batch = await insertBatch(tx, { tenantId, branchId: branch.id, programId: program.id, name: "Iso", startDate: "2026-01-01" });
    return tx.insert(sessions).values({
      id: uuidv7(),
      tenantId,
      branchId: branch.id,
      batchId: batch.id,
      startsAt: new Date("2026-10-05T12:30:00Z"),
      endsAt: new Date("2026-10-05T13:30:00Z"),
      sessionDate: "2026-10-05",
    });
  },
};
