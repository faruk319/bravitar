import type { IsolationFixtures } from "@/lib/db/isolation/types";
import type { Tx } from "@/lib/db/client";
import { createBranch } from "@/modules/tenancy/repo";
import { createGuardian, createHousehold, insertStudent, linkGuardian, recordConsent } from "./repo";
import { studentCodeSeries } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 8);
const phone = () => `+91${String(6_000_000_000 + Math.floor(Math.random() * 3_999_999_999))}`;

async function family(tx: Tx, tenantId: string) {
  const h = await createHousehold(tx, { tenantId, name: `Fam ${stamp()}` });
  const g = await createGuardian(tx, { tenantId, householdId: h.id, fullName: "Iso Guardian", phone: phone(), isPrimary: true });
  const b = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
  const s = await insertStudent(tx, { tenantId, branchId: b.id, householdId: h.id, code: `ISO/2026/${stamp().toUpperCase()}`, fullName: "Iso Student" });
  return { h, g, s };
}

export const studentFixtures: IsolationFixtures = {
  households: (tx, tenantId) => createHousehold(tx, { tenantId, name: `Fam ${stamp()}` }),
  guardians: async (tx, tenantId) => (await family(tx, tenantId)).g,
  students: async (tx, tenantId) => (await family(tx, tenantId)).s,
  student_guardians: async (tx, tenantId) => {
    const { g, s } = await family(tx, tenantId);
    return linkGuardian(tx, tenantId, s.id, g.id, "father");
  },
  consents: async (tx, tenantId) => {
    const { g, s } = await family(tx, tenantId);
    return recordConsent(tx, { tenantId, studentId: s.id, guardianId: g.id, kind: "data_processing", granted: true, method: "staff_recorded" });
  },
  student_code_series: (tx, tenantId) => tx.insert(studentCodeSeries).values({ tenantId, year: 1900 + Math.floor(Math.random() * 100) }),
};

