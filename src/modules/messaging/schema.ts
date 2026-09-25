import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "@/modules/staff/schema";
import { tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0017_share_links.sql.
const app = pgSchema("app");

export const SHARE_KINDS = ["invoice", "receipt"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export const shareLinks = app.table("share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  kind: text("kind", { enum: SHARE_KINDS }).notNull(),
  entityId: uuid("entity_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by").references(() => staffUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type ShareLink = typeof shareLinks.$inferSelect;
