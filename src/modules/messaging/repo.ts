import { and, asc, desc, eq, gte, inArray, lte, ne, type SQL, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { guardians } from "@/modules/students/schema";
import { tenants } from "@/modules/tenancy/schema";
import { type MessageLog, messageLog, type MessageStatus, type MessageTemplate, messageTemplates } from "./schema";
import { CATEGORIES, type Category, type Language } from "./templates";

export async function templateRows(tx: Tx, language: Language): Promise<MessageTemplate[]> {
  return tx.select().from(messageTemplates).where(eq(messageTemplates.language, language));
}

export async function upsertTemplate(tx: Tx, row: Omit<typeof messageTemplates.$inferInsert, "id" | "updatedAt">): Promise<MessageTemplate> {
  const [t] = await tx
    .insert(messageTemplates)
    .values({ id: uuidv7(), ...row })
    .onConflictDoUpdate({
      target: [messageTemplates.tenantId, messageTemplates.key, messageTemplates.language],
      set: { body: row.body, isActive: row.isActive, providerTemplateName: row.providerTemplateName ?? null, updatedBy: row.updatedBy ?? null, updatedAt: sql`now()` },
    })
    .returning();
  if (!t) throw new Error("template upsert returned no row");
  return t;
}

// Which of these messages were already made.
export async function dedupeKeysTaken(tx: Tx, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await tx.select({ key: messageLog.dedupeKey }).from(messageLog).where(inArray(messageLog.dedupeKey, keys));
  return new Set(rows.flatMap((r) => (r.key ? [r.key] : [])));
}

// A repeat of a dedupe key is dropped: that message was already made.
export async function insertMessage(tx: Tx, row: Omit<typeof messageLog.$inferInsert, "id">): Promise<MessageLog | undefined> {
  const [m] = await tx
    .insert(messageLog)
    .values({ id: uuidv7(), ...row })
    .onConflictDoNothing()
    .returning();
  return m;
}

export type MessageRow = MessageLog & { guardianName: string | null };

export async function listMessages(tx: Tx, statuses: MessageStatus[], opts: { channel?: MessageLog["channel"]; dueBy?: Date; limit?: number } = {}): Promise<MessageRow[]> {
  const rows = await tx
    .select({ m: messageLog, guardianName: guardians.fullName })
    .from(messageLog)
    .leftJoin(guardians, eq(guardians.id, messageLog.guardianId))
    .where(and(inArray(messageLog.status, statuses), opts.channel ? eq(messageLog.channel, opts.channel) : undefined, opts.dueBy ? lte(messageLog.sendAfter, opts.dueBy) : undefined))
    .orderBy(desc(messageLog.createdAt), desc(messageLog.id))
    .limit(opts.limit ?? 200);
  return rows.map((r) => ({ ...r.m, guardianName: r.guardianName }));
}

export async function countToSend(tx: Tx, dueBy: Date): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(messageLog)
    .where(and(eq(messageLog.status, "queued"), eq(messageLog.channel, "manual"), lte(messageLog.sendAfter, dueBy)));
  return r?.n ?? 0;
}

export async function getMessage(tx: Tx, id: string): Promise<MessageLog | undefined> {
  const [m] = await tx.select().from(messageLog).where(eq(messageLog.id, id));
  return m;
}

export async function messageByProviderId(tx: Tx, providerMessageId: string): Promise<MessageLog | undefined> {
  const [m] = await tx.select().from(messageLog).where(eq(messageLog.providerMessageId, providerMessageId));
  return m;
}

export async function updateMessage(tx: Tx, id: string, patch: Partial<typeof messageLog.$inferInsert>): Promise<MessageLog> {
  const [m] = await tx.update(messageLog).set(patch).where(eq(messageLog.id, id)).returning();
  if (!m) throw new Error("message update matched no row");
  return m;
}

// ---- the send job's queue

const queued = eq(messageLog.status, "queued");

// Why a queued message no longer holds, checked in SQL against what it is about.
const STALE: { type: string; holds: SQL; reason: string }[] = [
  { type: "invoice", holds: sql`EXISTS (SELECT 1 FROM app.invoices i WHERE i.id = ${messageLog.relatedId} AND i.status IN ('issued', 'part_paid'))`, reason: "Paid or voided before it went" },
  { type: "attendance", holds: sql`EXISTS (SELECT 1 FROM app.attendance a WHERE a.id = ${messageLog.relatedId} AND a.status = 'absent')`, reason: "No longer marked absent" },
  { type: "payment", holds: sql`EXISTS (SELECT 1 FROM app.payments p WHERE p.id = ${messageLog.relatedId} AND p.status <> 'cancelled')`, reason: "The payment was cancelled" },
];

// Skips queued messages whose reason is gone; returns how many.
export async function skipStale(tx: Tx): Promise<number> {
  let n = 0;
  for (const s of STALE) {
    const rows = await tx
      .update(messageLog)
      .set({ status: "skipped", error: s.reason })
      .where(and(queued, eq(messageLog.relatedType, s.type), sql`NOT ${s.holds}`))
      .returning({ id: messageLog.id });
    n += rows.length;
  }
  return n;
}

export async function skipAbout(tx: Tx, relatedType: string, relatedIds: string[], reason: string): Promise<number> {
  if (!relatedIds.length) return 0;
  const rows = await tx
    .update(messageLog)
    .set({ status: "skipped", error: reason })
    .where(and(queued, eq(messageLog.relatedType, relatedType), inArray(messageLog.relatedId, relatedIds)))
    .returning({ id: messageLog.id });
  return rows.length;
}

// The next WhatsApp message due, locked so two workers never send it twice.
export async function nextDue(tx: Tx, now: Date): Promise<MessageLog | undefined> {
  const [m] = await tx
    .select()
    .from(messageLog)
    .where(and(queued, eq(messageLog.channel, "whatsapp"), lte(messageLog.sendAfter, now)))
    .orderBy(asc(messageLog.sendAfter), asc(messageLog.id))
    .limit(1)
    .for("update", { skipLocked: true });
  return m;
}

// Sent through WhatsApp since `since`: what counts towards the daily cap.
export async function sentSince(tx: Tx, since: Date): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(messageLog)
    .where(and(eq(messageLog.channel, "whatsapp"), gte(messageLog.sentAt, since)));
  return r?.n ?? 0;
}

// Sent to a guardian in a category since `since`, by WhatsApp or by hand.
export async function sentToGuardian(tx: Tx, guardianId: string, category: Category, since: Date): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(messageLog)
    .where(and(eq(messageLog.guardianId, guardianId), eq(messageLog.category, category), gte(messageLog.sentAt, since), ne(messageLog.status, "skipped")));
  return r?.n ?? 0;
}

// Every due WhatsApp message moves to `until(category)`; returns how many.
export async function deferDue(tx: Tx, now: Date, until: (category: Category) => Date): Promise<number> {
  let n = 0;
  for (const category of CATEGORIES) {
    const rows = await tx
      .update(messageLog)
      .set({ sendAfter: until(category) })
      .where(and(queued, eq(messageLog.channel, "whatsapp"), eq(messageLog.category, category), lte(messageLog.sendAfter, now)))
      .returning({ id: messageLog.id });
    n += rows.length;
  }
  return n;
}

// Across academies (platformRead): which active ones have WhatsApp messages due.
export async function tenantsWithDue(tx: PlatformTx, now: Date): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: messageLog.tenantId })
    .from(messageLog)
    .innerJoin(tenants, eq(tenants.id, messageLog.tenantId))
    .where(and(queued, eq(messageLog.channel, "whatsapp"), lte(messageLog.sendAfter, now), eq(tenants.status, "active"), sql`${tenants.deletedAt} IS NULL`));
  return rows.map((r) => r.id);
}
