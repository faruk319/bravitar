import { boolean, customType, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "@/modules/staff/schema";
import { tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0016_razorpay.sql.
const app = pgSchema("app");
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const INTEGRATION_KINDS = ["razorpay", "whatsapp"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

// What is safe to show: never a secret.
export type IntegrationConfig = { keyId?: string; mode?: "test" | "live"; phone?: string; name?: string };

export const tenantIntegrations = app.table("tenant_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  kind: text("kind", { enum: INTEGRATION_KINDS }).notNull(),
  credentials: bytea("credentials").notNull(), // sealed by src/lib/crypto
  config: jsonb("config").$type<IntegrationConfig>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  connectedBy: uuid("connected_by").references(() => staffUsers.id),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEvents = app.table("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: text("provider", { enum: ["razorpay", "whatsapp"] }).notNull(),
  providerEventId: text("provider_event_id").notNull(),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

export type TenantIntegration = typeof tenantIntegrations.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
