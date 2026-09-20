import { boolean, char, customType, jsonb, pgSchema, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors migrations/0002_tenants_and_branches.sql. DDL lives in the migration;
// this file exists for typed queries and must be kept in step with it.
export const app = pgSchema("app");

const citext = customType<{ data: string }>({ dataType: () => "extensions.citext" });

export type EnabledModules = Record<string, boolean>;

// Same values as the column default in migration 0002.
export const DEFAULT_ENABLED_MODULES: EnabledModules = {
  students: true, batches: true, attendance: true, fees: true,
  enquiries: true, messaging: true, reports: true,
  progression: false, credits: false, bookings: false, pos: false,
};

export const tenants = app.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: citext("slug").notNull().unique(),
  verticalPreset: text("vertical_preset").notNull().default("general"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  locale: text("locale").notNull().default("en-IN"),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  fyStartMonth: smallint("fy_start_month").notNull().default(4),
  enabledModules: jsonb("enabled_modules").$type<EnabledModules>().notNull().default(DEFAULT_ENABLED_MODULES),
  labelOverrides: jsonb("label_overrides").$type<Record<string, string>>().notNull().default({}),
  status: text("status", { enum: ["active", "suspended", "closed"] }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const branches = app.table("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Tenant = typeof tenants.$inferSelect;
export type Branch = typeof branches.$inferSelect;
