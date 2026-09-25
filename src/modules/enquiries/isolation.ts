import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createProgram, insertBatch } from "@/modules/batches/repo";
import { sessions } from "@/modules/sessions/schema";
import { createBranch } from "@/modules/tenancy/repo";
import { insertEnquiry } from "./repo";
import { enquiryActivities, trialAttendances } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 8);
type FixtureTx = Parameters<IsolationFixtures[string]>[0];

const enquiry = async (tx: FixtureTx, tenantId: string) => {
  const branch = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
  return { branch, e: await insertEnquiry(tx, { tenantId, branchId: branch.id, name: "Iso Enquiry", phone: "+919800000009" }) };
};

export const enquiryFixtures: IsolationFixtures = {
  enquiries: enquiry,
  enquiry_activities: async (tx, tenantId) => {
    const { e } = await enquiry(tx, tenantId);
    return tx.insert(enquiryActivities).values({ id: uuidv7(), tenantId, enquiryId: e.id, kind: "call" });
  },
  trial_attendances: async (tx, tenantId) => {
    const { branch, e } = await enquiry(tx, tenantId);
    const program = await createProgram(tx, { tenantId, name: `Program ${stamp()}` });
    const batch = await insertBatch(tx, { tenantId, branchId: branch.id, programId: program.id, name: "Iso", startDate: "2026-01-01" });
    const [session] = await tx
      .insert(sessions)
      .values({ id: uuidv7(), tenantId, branchId: branch.id, batchId: batch.id, startsAt: new Date("2026-10-05T12:30:00Z"), endsAt: new Date("2026-10-05T13:30:00Z"), sessionDate: "2026-10-05" })
      .returning();
    return tx.insert(trialAttendances).values({ id: uuidv7(), tenantId, enquiryId: e.id, sessionId: session?.id ?? "", trialDate: "2026-10-05" });
  },
};
