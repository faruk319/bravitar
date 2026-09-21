import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";

export function formatStudentCode(prefix: string, year: number, n: number): string {
  return `${prefix}/${year}/${String(n).padStart(4, "0")}`;
}

export const STUDENT_CODE_RE = /^[A-Z]{2,5}\/\d{4}\/\d{4,}$/;

// UPDATE ... RETURNING takes the row lock, so concurrent callers serialise and
// never share a number. The year row is created on first use.
export async function nextStudentCode(tx: Tx, tenantId: string, prefix: string, year: number): Promise<string> {
  await tx.execute(sql`INSERT INTO app.student_code_series (tenant_id, year) VALUES (${tenantId}, ${year}) ON CONFLICT DO NOTHING`);
  const rows = await tx.execute<{ assigned: number }>(sql`
    UPDATE app.student_code_series SET next_value = next_value + 1
     WHERE tenant_id = ${tenantId} AND year = ${year}
    RETURNING next_value - 1 AS assigned`);
  const n = rows[0]?.assigned;
  if (n === undefined) throw new Error("student code allocation returned no row");
  return formatStudentCode(prefix, year, n);
}
