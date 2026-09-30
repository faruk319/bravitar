import { bigint, boolean, date, integer, pgSchema, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { platformAdmins } from "@/modules/platform/schema";
import { branches, tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0026_activity_billing.sql. What an academy pays Bravitar,
// per activity per branch; shares no tables with what academies charge students.
const app = pgSchema("app");

export const ACTIVITY_STATUSES = ["active", "coming_soon", "retired"] as const;

export const activities = app.table("activities", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: ACTIVITY_STATUSES }).notNull().default("active"),
  pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
  billingInterval: text("billing_interval", { enum: ["month"] }).notNull().default("month"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityPriceHistory = app.table("activity_price_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityKey: text("activity_key").notNull().references(() => activities.key),
  oldPaise: bigint("old_paise", { mode: "bigint" }).notNull(),
  newPaise: bigint("new_paise", { mode: "bigint" }).notNull(),
  reason: text("reason"),
  changedBy: uuid("changed_by").references(() => platformAdmins.id),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingSettings = app.table("billing_settings", {
  id: boolean("id").primaryKey().default(true),
  graceDays: smallint("grace_days").notNull().default(7),
  trialDays: smallint("trial_days").notNull().default(30),
  taxRateBp: integer("tax_rate_bp").notNull().default(0), // 1800 = 18%
  gstin: text("gstin"),
  howToPay: text("how_to_pay"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const SUBSCRIPTION_STATUSES = ["trial", "active", "paused", "cancelled"] as const;

// periodEnd is the next bill date (the trial's end while on trial).
export const activitySubscriptions = app.table("activity_subscriptions", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  activityKey: text("activity_key").notNull().references(() => activities.key),
  status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
  pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
  overridePaise: bigint("override_paise", { mode: "bigint" }),
  overrideUntil: date("override_until"),
  overrideReason: text("override_reason"),
  anchorDay: smallint("anchor_day").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export type Activity = typeof activities.$inferSelect;
export type BillingSettings = typeof billingSettings.$inferSelect;
export type ActivitySubscription = typeof activitySubscriptions.$inferSelect;
