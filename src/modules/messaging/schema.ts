import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "@/modules/staff/schema";
import { guardians } from "@/modules/students/schema";
import { tenants } from "@/modules/tenancy/schema";
import { LANGUAGES, TEMPLATE_KEYS } from "./templates";

// Mirrors migrations/0017_share_links.sql and 0018_messaging.sql.
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

export const messageTemplates = app.table("message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  key: text("key", { enum: TEMPLATE_KEYS }).notNull(),
  channel: text("channel", { enum: ["whatsapp"] }).notNull().default("whatsapp"),
  language: text("language", { enum: LANGUAGES }).notNull(),
  body: text("body").notNull(),
  providerTemplateName: text("provider_template_name"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => staffUsers.id),
});

export const MESSAGE_STATUSES = ["queued", "sent", "delivered", "read", "failed", "skipped"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const messageLog = app.table("message_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  guardianId: uuid("guardian_id").references(() => guardians.id),
  toPhone: text("to_phone").notNull(),
  channel: text("channel", { enum: ["whatsapp", "manual"] }).notNull(),
  templateKey: text("template_key", { enum: TEMPLATE_KEYS }).notNull(),
  category: text("category", { enum: ["fees", "receipts", "attendance", "classes", "welcome"] }).notNull(),
  language: text("language", { enum: LANGUAGES }).notNull(),
  variables: jsonb("variables").$type<Record<string, string>>().notNull().default({}),
  body: text("body").notNull(),
  relatedType: text("related_type"),
  relatedId: uuid("related_id"),
  dedupeKey: text("dedupe_key"),
  sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
  status: text("status", { enum: MESSAGE_STATUSES }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentBy: uuid("sent_by").references(() => staffUsers.id),
});

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type MessageLog = typeof messageLog.$inferSelect;
