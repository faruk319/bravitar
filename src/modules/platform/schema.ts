import { bigint, boolean, customType, inet, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0003_platform_layer.sql and 0024_platform_admins.sql. What
// the academy pays us — shares no tables with what the academy charges students.
const app = pgSchema("app");
const citext = customType<{ data: string }>({ dataType: () => "extensions.citext" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const platformPlans = app.table("platform_plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
  billingCycle: text("billing_cycle", { enum: ["monthly", "yearly"] }).notNull(),
  maxStudents: integer("max_students"),
  maxStaff: integer("max_staff"),
  maxBranches: integer("max_branches"),
  includedModules: jsonb("included_modules").$type<Record<string, boolean>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
});

export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;

export const tenantSubscriptions = app.table("tenant_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  planCode: text("plan_code").notNull().references(() => platformPlans.code),
  status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// You, in /platform. The authenticator secret is sealed by src/lib/crypto.
export const platformAdmins = app.table("platform_admins", {
  id: uuid("id").primaryKey(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: bytea("totp_secret").notNull(),
  totpLastStep: bigint("totp_last_step", { mode: "number" }).notNull().default(0),
  fullName: text("full_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformLoginAttempts = app.table("platform_login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull(),
  ip: inet("ip"),
  succeeded: boolean("succeeded").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type PlatformPlan = typeof platformPlans.$inferSelect;
export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
