import { bigserial, inet, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors app.audit_log in migration 0003. Append-only: UPDATE and DELETE are
// revoked from both app roles at the database.
const app = pgSchema("app");

export const auditLog = app.table("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id"),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  impersonatedBy: uuid("impersonated_by"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: inet("ip"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditEntry = {
  action: string; // 'tenant.create', 'payment.create', 'role.update', ...
  actorType: "platform" | "staff" | "guardian" | "system";
  actorId?: string;
  impersonatedBy?: string;
  tenantId?: string; // omitted for platform-level actions
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
};

type Insertable = { insert: (table: typeof auditLog) => { values: (v: typeof auditLog.$inferInsert) => Promise<unknown> } };

// Works with a tenant Tx (RLS limits it to its own tenant_id) and a PlatformTx.
// impersonatedBy left out takes the transaction's app.impersonated_by.
export async function writeAudit(tx: Insertable, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    ...(entry.impersonatedBy ? { impersonatedBy: entry.impersonatedBy } : {}),
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
  });
}
