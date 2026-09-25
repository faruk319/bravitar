import type { PgBoss } from "pg-boss";
import type { Tx } from "@/lib/db/client";
import { platformRead } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { forEachTenant, type TenantRun } from "@/lib/jobs/tenants";
import type { WhatsappApi } from "@/modules/integrations/whatsapp";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { adapterFor } from "./adapter";
import { queueReminders } from "./reminders";
import { deferDue, nextDue, sentSince, sentToGuardian, skipStale, tenantsWithDue, updateMessage } from "./repo";
import { dayStart, hourFor, localHour, QUIET_FROM, QUIET_UNTIL, tomorrowAt } from "./schedule";
import { deliverMessage } from "./service";
import type { Category } from "./templates";

export const MESSAGES_REMIND = "messages.remind";
export const MESSAGES_SEND = "messages.send";
const MAX_PER_RUN = 200; // per academy per minute

export function runMessagesRemind(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<TenantRun> {
  return forEachTenant(
    MESSAGES_REMIND,
    async (tx) => {
      await queueReminders(tx, opts.now ? { now: opts.now } : {});
    },
    opts.tenantIds,
  );
}

export type Sent = { sent: number; failed: number; deferred: number; skipped: number; byHand: number };
const none = (): Sent => ({ sent: 0, failed: 0, deferred: 0, skipped: 0, byHand: 0 });
const add = (to: Sent, from: Partial<Sent>) => {
  for (const k of Object.keys(to) as (keyof Sent)[]) to[k] += from[k] ?? 0;
};

// The next due WhatsApp message, or undefined when there is nothing to do now.
// Nothing goes in quiet hours; past the academy's daily cap, or a guardian's
// one message a day in a category (receipts aside), it moves to the next day.
async function sendOne(tx: Tx, now: Date, api?: WhatsappApi): Promise<Partial<Sent> | undefined> {
  const tenant = await getOwnTenant(tx);
  if (!tenant) return undefined;
  const tz = tenant.timezone;
  const hour = localHour(now, tz);
  if (hour < QUIET_UNTIL || hour >= QUIET_FROM) return undefined;
  const m = await nextDue(tx, now);
  if (!m) return undefined;
  const since = dayStart(now, tz);
  const nextDay = (c: Category) => tomorrowAt(now, tz, hourFor(c, tenant));
  if ((await sentSince(tx, since)) >= tenant.messageDailyCap) return { deferred: await deferDue(tx, now, nextDay) };
  if (m.category !== "receipts" && m.guardianId && (await sentToGuardian(tx, m.guardianId, m.category, since)) > 0) {
    await updateMessage(tx, m.id, { sendAfter: nextDay(m.category) });
    return { deferred: 1 };
  }
  const done = await deliverMessage(tx, m, await adapterFor(tx, api ? { api } : {}), { now });
  return { [done.status === "queued" ? "byHand" : done.status === "sent" ? "sent" : done.status === "failed" ? "failed" : "skipped"]: 1 };
}

// One academy's due WhatsApp messages, one per transaction so a slow call to
// Meta holds a single row.
export async function sendDue(tenantId: string, opts: { now?: Date; api?: WhatsappApi } = {}): Promise<Sent> {
  const out = none();
  out.skipped += await withTenant(tenantId, skipStale);
  for (let i = 0; i < MAX_PER_RUN; i++) {
    const r = await withTenant(tenantId, (tx) => sendOne(tx, opts.now ?? new Date(), opts.api));
    if (!r) break;
    add(out, r);
  }
  return out;
}

// Every minute; only academies with a WhatsApp message due are visited.
export async function runMessagesSend(opts: { now?: Date; api?: WhatsappApi; tenantIds?: string[] } = {}): Promise<Sent> {
  const due = await platformRead((tx) => tenantsWithDue(tx, opts.now ?? new Date()));
  const out = none();
  for (const id of due.filter((d) => !opts.tenantIds || opts.tenantIds.includes(d))) {
    try {
      add(out, await sendDue(id, opts));
    } catch (e) {
      console.error(`${MESSAGES_SEND}: ${id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

export async function workMessages(boss: PgBoss): Promise<void> {
  await boss.createQueue(MESSAGES_REMIND);
  await boss.work<{ tenantIds?: string[] } | null, TenantRun>(MESSAGES_REMIND, async ([job]) => runMessagesRemind(job?.data?.tenantIds ? { tenantIds: job.data.tenantIds } : {}));
  await boss.createQueue(MESSAGES_SEND);
  await boss.work<null, Sent>(MESSAGES_SEND, async () => runMessagesSend());
}
