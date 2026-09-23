import type { Tx } from "@/lib/db/client";
import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { createBranch } from "@/modules/tenancy/repo";
import { createHoliday, createProgram, insertBatch, insertRules } from "./repo";

const stamp = () => Math.random().toString(36).slice(2, 8);

async function batch(tx: Tx, tenantId: string) {
  const [program, branch] = [await createProgram(tx, { tenantId, name: `Program ${stamp()}` }), await createBranch(tx, { tenantId, name: `Branch ${stamp()}` })];
  return insertBatch(tx, { tenantId, branchId: branch.id, programId: program.id, name: "Iso batch", startDate: "2026-01-01" });
}

export const batchFixtures: IsolationFixtures = {
  programs: (tx, tenantId) => createProgram(tx, { tenantId, name: `Program ${stamp()}` }),
  batches: batch,
  batch_schedules: async (tx, tenantId) => insertRules(tx, tenantId, (await batch(tx, tenantId)).id, [{ weekday: 1, startTime: "18:00", endTime: "19:00" }], "2026-01-01"),
  holidays: async (tx, tenantId) => createHoliday(tx, { tenantId, branchId: (await createBranch(tx, { tenantId, name: `Branch ${stamp()}` })).id, date: "2026-10-02", name: "Iso holiday" }),
};
