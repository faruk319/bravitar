import { boolean, customType, inet, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0005_sessions_and_login_attempts.sql.
const app = pgSchema("app");
const citext = customType<{ data: string }>({ dataType: () => "extensions.citext" });

export const SESSION_ACTOR_TYPES = ["platform", "staff", "guardian"] as const;

export const sessionsAuth = app.table("sessions_auth", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  actorType: text("actor_type", { enum: SESSION_ACTOR_TYPES }).notNull(),
  actorId: uuid("actor_id").notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  impersonatedBy: uuid("impersonated_by"),
  cachedContext: jsonb("cached_context"),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loginAttempts = app.table("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  email: citext("email").notNull(),
  ip: inet("ip"),
  succeeded: boolean("succeeded").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SessionRow = typeof sessionsAuth.$inferSelect;
