import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { type IntegrationKind, type TenantIntegration, tenantIntegrations, type WebhookEvent, webhookEvents } from "./schema";

// RLS limits every read and write here to the academy on the transaction.
export async function getIntegration(tx: Tx, kind: IntegrationKind): Promise<TenantIntegration | undefined> {
  const [row] = await tx.select().from(tenantIntegrations).where(eq(tenantIntegrations.kind, kind));
  return row;
}

// One row per academy and kind: saving again replaces the keys.
export async function saveIntegration(tx: Tx, row: Omit<typeof tenantIntegrations.$inferInsert, "id">): Promise<TenantIntegration> {
  const [saved] = await tx
    .insert(tenantIntegrations)
    .values({ id: uuidv7(), ...row })
    .onConflictDoUpdate({
      target: [tenantIntegrations.tenantId, tenantIntegrations.kind],
      set: { credentials: row.credentials, config: row.config ?? {}, isActive: true, connectedAt: row.connectedAt ?? null, connectedBy: row.connectedBy ?? null, lastError: null },
    })
    .returning();
  if (!saved) throw new Error("integration save returned no row");
  return saved;
}

export async function setIntegrationError(tx: Tx, id: string, lastError: string | null): Promise<void> {
  await tx.update(tenantIntegrations).set({ lastError }).where(eq(tenantIntegrations.id, id));
}

export async function lastWebhookAt(tx: Tx): Promise<Date | null> {
  const [r] = await tx.select({ at: sql<Date | null>`max(${webhookEvents.receivedAt})` }).from(webhookEvents);
  return r?.at ? new Date(r.at) : null;
}

// The unique index is the idempotency (docs/02 §11): undefined means seen before.
export async function storeEvent(tx: Tx, row: Omit<typeof webhookEvents.$inferInsert, "id">): Promise<WebhookEvent | undefined> {
  const [stored] = await tx
    .insert(webhookEvents)
    .values({ id: uuidv7(), ...row })
    .onConflictDoNothing({ target: [webhookEvents.tenantId, webhookEvents.provider, webhookEvents.providerEventId] })
    .returning();
  return stored;
}

export async function markEvent(tx: Tx, id: string, processedAt: Date, error: string | null): Promise<void> {
  await tx.update(webhookEvents).set({ processedAt, error }).where(eq(webhookEvents.id, id));
}
