import { and, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { addDays, todayIn } from "@/lib/dates";
import { listHolidays, rulesFor } from "@/modules/batches/repo";
import { batches } from "@/modules/batches/schema";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { HORIZON_DAYS, type Occurrence, planOccurrences } from "./occurrences";
import { changeableSessions, datesWithHistory, deleteSessions, insertSessions, setSessionStatus } from "./repo";
import type { Session } from "./schema";

export const HOLIDAY_REASON = "Holiday";

type ReconcileResult = { created: number; cancelled: number; restored: number; removed: number };

const keyOf = (batchId: string, startsAt: Date) => `${batchId}|${startsAt.toISOString()}`;

// Makes the stored sessions match the plan for the tenant on the transaction:
// inserts missing classes, cancels ones that now fall on a holiday, restores
// ones whose holiday was removed, and deletes ones no longer planned. Only
// future, not-yet-held rows are ever touched (see `changeable`). Manually
// cancelled classes are left as they are.
export async function reconcileSessions(tx: Tx, opts: { now?: Date; batchIds?: string[] } = {}): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const tenant = await getOwnTenant(tx);
  if (!tenant) throw new Error("reconcileSessions: no tenant on this transaction");
  const today = todayIn(tenant.timezone, now);

  const live = await tx
    .select()
    .from(batches)
    .where(and(isNull(batches.deletedAt), opts.batchIds ? inArray(batches.id, opts.batchIds) : undefined));
  const rules = await rulesFor(tx, live.map((b) => b.id));
  const holidays = await listHolidays(tx, [], { from: today, to: addDays(today, HORIZON_DAYS) });
  const plan = planOccurrences({
    batches: live.map((b) => ({ id: b.id, branchId: b.branchId, startDate: b.startDate, endDate: b.endDate, status: b.status, rules: rules.filter((r) => r.batchId === b.id) })),
    holidays: holidays.map((h) => ({ date: h.date, branchId: h.branchId, name: h.name })),
    timeZone: tenant.timezone,
    now,
  });

  // One generated class per batch per day: a day whose class already started keeps only that one.
  const done = await datesWithHistory(tx, now, today, opts.batchIds);
  const planned = new Map<string, Occurrence>(plan.filter((o) => !done.has(`${o.batchId}|${o.sessionDate}`)).map((o) => [keyOf(o.batchId, o.startsAt), o]));
  const existing = await changeableSessions(tx, now, opts.batchIds);
  const stored = new Map<string, Session>(existing.map((s) => [keyOf(s.batchId, s.startsAt), s]));

  const toInsert = [...planned.values()].filter((o) => !o.holiday && !stored.has(keyOf(o.batchId, o.startsAt)));
  const toCancel: string[] = [];
  const toRestore: string[] = [];
  const toDelete: string[] = [];
  for (const s of existing) {
    const o = planned.get(keyOf(s.batchId, s.startsAt));
    const holidayCancelled = s.status === "cancelled" && s.cancelReason === HOLIDAY_REASON;
    if (!o) {
      if (s.status === "scheduled" || holidayCancelled) toDelete.push(s.id);
    } else if (o.holiday && s.status === "scheduled") toCancel.push(s.id);
    else if (!o.holiday && holidayCancelled) toRestore.push(s.id);
  }

  await deleteSessions(tx, toDelete);
  await setSessionStatus(tx, toCancel, "cancelled", HOLIDAY_REASON);
  await setSessionStatus(tx, toRestore, "scheduled", null);
  const created = await insertSessions(
    tx,
    toInsert.map((o) => ({ tenantId: tenant.id, branchId: o.branchId, batchId: o.batchId, startsAt: o.startsAt, endsAt: o.endsAt, sessionDate: o.sessionDate })),
  );
  return { created, cancelled: toCancel.length, restored: toRestore.length, removed: toDelete.length };
}
