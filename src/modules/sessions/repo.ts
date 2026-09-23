import { and, asc, eq, gt, gte, inArray, ne, not, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { type Session, sessions } from "./schema";

// The only rows the generator may change: future and not yet held.
// CONTRACT for the attendance slice: marking attendance sets status 'held',
// and "has attendance rows" must be added to this predicate.
function changeable(now: Date): SQL {
  return and(gt(sessions.startsAt, now), ne(sessions.status, "held")) as SQL;
}

// Generated rows only: classes added by hand are never the generator's to change.
export async function changeableSessions(tx: Tx, now: Date, batchIds?: string[]): Promise<Session[]> {
  return tx
    .select()
    .from(sessions)
    .where(and(changeable(now), eq(sessions.generated, true), batchIds ? inArray(sessions.batchId, batchIds) : undefined));
}

// "batchId|date" for dates from `from` whose generated class already started or
// was held, so a timing change made later that day can't add a second one.
export async function datesWithHistory(tx: Tx, now: Date, from: string, batchIds?: string[]): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ batchId: sessions.batchId, date: sessions.sessionDate })
    .from(sessions)
    .where(and(not(changeable(now)), eq(sessions.generated, true), gte(sessions.sessionDate, from), batchIds ? inArray(sessions.batchId, batchIds) : undefined));
  return new Set(rows.map((r) => `${r.batchId}|${r.date}`));
}

type NewSession = Pick<Session, "tenantId" | "branchId" | "batchId" | "startsAt" | "endsAt" | "sessionDate">;

// Chunked so a 200-batch tenant stays well under the parameter limit.
export async function insertSessions(tx: Tx, rows: NewSession[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ id: uuidv7(), ...r }));
    const inserted = await tx.insert(sessions).values(chunk).onConflictDoNothing({ target: [sessions.batchId, sessions.startsAt] }).returning({ id: sessions.id });
    n += inserted.length;
  }
  return n;
}

export async function setSessionStatus(tx: Tx, ids: string[], status: Session["status"], cancelReason: string | null): Promise<void> {
  for (let i = 0; i < ids.length; i += 1000) await tx.update(sessions).set({ status, cancelReason }).where(inArray(sessions.id, ids.slice(i, i + 1000)));
}

export async function deleteSessions(tx: Tx, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 1000) await tx.delete(sessions).where(inArray(sessions.id, ids.slice(i, i + 1000)));
}

export async function upcomingForBatch(tx: Tx, batchId: string, from: Date, limit: number): Promise<Session[]> {
  return tx
    .select()
    .from(sessions)
    .where(and(eq(sessions.batchId, batchId), gt(sessions.startsAt, from)))
    .orderBy(asc(sessions.startsAt))
    .limit(limit);
}
