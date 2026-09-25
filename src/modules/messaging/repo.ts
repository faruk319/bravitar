import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { guardians } from "@/modules/students/schema";
import { type MessageLog, messageLog, type MessageStatus, type MessageTemplate, messageTemplates } from "./schema";
import type { Language } from "./templates";

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

export async function listMessages(tx: Tx, statuses: MessageStatus[], opts: { channel?: MessageLog["channel"]; limit?: number } = {}): Promise<MessageRow[]> {
  const rows = await tx
    .select({ m: messageLog, guardianName: guardians.fullName })
    .from(messageLog)
    .leftJoin(guardians, eq(guardians.id, messageLog.guardianId))
    .where(and(inArray(messageLog.status, statuses), opts.channel ? eq(messageLog.channel, opts.channel) : undefined))
    .orderBy(desc(messageLog.createdAt), desc(messageLog.id))
    .limit(opts.limit ?? 200);
  return rows.map((r) => ({ ...r.m, guardianName: r.guardianName }));
}

export async function countToSend(tx: Tx): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(messageLog).where(and(eq(messageLog.status, "queued"), eq(messageLog.channel, "manual")));
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
