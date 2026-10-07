import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { students } from "@/modules/students/schema";
import { createStudent, type StudentCtx } from "@/modules/students/service";

let seq = 0;

// Test-only. A family that can be billed ("<first word> family"): a paying guardian and one soft-deleted
// child, so rolls and counts stay as they were. Money needs a payer; a bare household has none.
export async function billableFamily(tx: Tx, ctx: StudentCtx, name: string): Promise<{ id: string; guardianId: string }> {
  const n = ++seq;
  const made = await createStudent(tx, ctx, { fullName: `Kid ${name.split(" ")[0]}`, guardian: { fullName: name, phone: `98700 ${String(10_000 + n)}`, relation: "mother" }, consents: { dataProcessing: true } });
  await tx.update(students).set({ deletedAt: new Date() }).where(eq(students.id, made.student.id));
  return { id: made.household.id, guardianId: made.guardian.id };
}
