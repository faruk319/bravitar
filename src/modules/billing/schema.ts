import { bigint, boolean, date, integer, pgSchema, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { platformAdmins } from "@/modules/platform/schema";
import { branches, tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0026_activity_billing.sql, 0027_activity_plans.sql,
// 0028_billing_invoices.sql, 0029_module_catalog.sql and 0030_billing_cycles.sql.
// What an academy pays Bravitar, per activity per branch; shares no tables
// with what academies charge students.
const app = pgSchema("app");

export const ACTIVITY_STATUSES = ["active", "coming_soon", "retired"] as const;

// Billed every month or every year; a subscription keeps the one it started on.
export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const activities = app.table("activities", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon").notNull(), // one of ACTIVITY_ICONS (src/lib/activities.ts)
  status: text("status", { enum: ACTIVITY_STATUSES }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Starter, Growth…: a price and optional limits (null = no limit). Owners pick
// offered plans; the platform may use any. The default one (offered, one per
// module) is used when none is picked.
export const activityPlans = app.table("activity_plans", {
  id: uuid("id").primaryKey(),
  activityKey: text("activity_key").notNull().references(() => activities.key),
  name: text("name").notNull(),
  pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
  maxStudents: integer("max_students"),
  maxStaff: integer("max_staff"),
  billingInterval: text("billing_interval", { enum: BILLING_INTERVALS }).notNull().default("month"),
  isOffered: boolean("is_offered").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const planPriceHistory = app.table("plan_price_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull().references(() => activityPlans.id),
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
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// periodEnd is the next bill date (the trial's end while on trial). A
// downgrade waits in nextPlanId until then.
export const activitySubscriptions = app.table("activity_subscriptions", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  activityKey: text("activity_key").notNull().references(() => activities.key),
  planId: uuid("plan_id").notNull(),
  nextPlanId: uuid("next_plan_id"),
  status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
  pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
  billingInterval: text("billing_interval", { enum: BILLING_INTERVALS }).notNull(),
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

// One series for all academies: BRV/2026-27/00001.
export const billingInvoiceSeries = app.table("billing_invoice_series", {
  fy: text("fy").primaryKey(),
  nextValue: integer("next_value").notNull().default(1),
});

// One per activity in a branch per month; periodEnd is the next bill date.
export const billingInvoices = app.table("billing_invoices", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  subscriptionId: uuid("subscription_id").notNull().references(() => activitySubscriptions.id),
  number: text("number").notNull(),
  description: text("description").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  subtotalPaise: bigint("subtotal_paise", { mode: "bigint" }).notNull(),
  taxRateBp: integer("tax_rate_bp").notNull(),
  taxPaise: bigint("tax_paise", { mode: "bigint" }).notNull(),
  totalPaise: bigint("total_paise", { mode: "bigint" }).notNull(),
  gstin: text("gstin"),
  status: text("status", { enum: ["open", "paid"] }).notNull().default("open"),
  issuedOn: date("issued_on").notNull(),
  dueOn: date("due_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Activity = typeof activities.$inferSelect;
export type ActivityPlan = typeof activityPlans.$inferSelect;
export type BillingSettings = typeof billingSettings.$inferSelect;
export type ActivitySubscription = typeof activitySubscriptions.$inferSelect;
export type BillingInvoice = typeof billingInvoices.$inferSelect;
