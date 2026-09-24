import { bigint, boolean, date, integer, jsonb, pgSchema, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { programs } from "@/modules/batches/schema";
import { enrollments } from "@/modules/enrollments/schema";
import { staffUsers } from "@/modules/staff/schema";
import { households, students } from "@/modules/students/schema";
import { branches, tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0014_fees.sql. Money is bigint paise.
const app = pgSchema("app");
const paise = (name: string) => bigint(name, { mode: "bigint" });

export const PLAN_KINDS = ["recurring", "term", "package", "one_time"] as const;
export const BILLING_CYCLES = ["monthly", "quarterly", "half_yearly", "yearly", "one_time"] as const;
export type Installment = { label: string; amount_paise: number; due_offset_days: number }; // docs/04 format
export type PlanMetadata = { installments?: Installment[] };

export const feePlans = app.table("fee_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  programId: uuid("program_id").references(() => programs.id),
  name: text("name").notNull(),
  kind: text("kind", { enum: PLAN_KINDS }).notNull().default("recurring"),
  billingCycle: text("billing_cycle", { enum: BILLING_CYCLES }).notNull(),
  amountPaise: paise("amount_paise").notNull(),
  admissionFeePaise: paise("admission_fee_paise").notNull().default(0n),
  billingDay: smallint("billing_day").notNull().default(1),
  graceDays: smallint("grace_days").notNull().default(7),
  lateFeePaise: paise("late_fee_paise").notNull().default(0n),
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  metadata: jsonb("metadata").$type<PlanMetadata>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const discounts = app.table("discounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["percent", "amount"] }).notNull(),
  value: integer("value").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studentDiscounts = app.table("student_discounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  studentId: uuid("student_id").notNull().references(() => students.id),
  discountId: uuid("discount_id").notNull().references(() => discounts.id),
  reason: text("reason").notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  approvedBy: uuid("approved_by").references(() => staffUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const INVOICE_STATUSES = ["draft", "issued", "part_paid", "paid", "overdue", "void"] as const;

export const invoices = app.table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  householdId: uuid("household_id").notNull().references(() => households.id),
  studentId: uuid("student_id").references(() => students.id),
  number: text("number"),
  fy: text("fy"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date").notNull(),
  subtotalPaise: paise("subtotal_paise").notNull().default(0n),
  discountPaise: paise("discount_paise").notNull().default(0n),
  taxPaise: paise("tax_paise").notNull().default(0n),
  totalPaise: paise("total_paise").notNull().default(0n),
  paidPaise: paise("paid_paise").notNull().default(0n),
  status: text("status", { enum: INVOICE_STATUSES }).notNull().default("draft"),
  voidReason: text("void_reason"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const LINE_KINDS = ["tuition", "admission", "exam", "late_fee", "item", "other"] as const;

export const invoiceLines = app.table("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  enrollmentId: uuid("enrollment_id").references(() => enrollments.id),
  studentId: uuid("student_id").references(() => students.id),
  feePlanId: uuid("fee_plan_id").references(() => feePlans.id),
  kind: text("kind", { enum: LINE_KINDS }).notNull(),
  description: text("description").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  quantity: integer("quantity").notNull().default(1),
  unitPaise: paise("unit_paise").notNull(),
  discountPaise: paise("discount_paise").notNull().default(0n),
  discountNote: text("discount_note"),
  taxPaise: paise("tax_paise").notNull().default(0n),
  amountPaise: paise("amount_paise").notNull(),
  billingKey: text("billing_key"),
});

export type FeePlan = typeof feePlans.$inferSelect;
export type Discount = typeof discounts.$inferSelect;
export type StudentDiscount = typeof studentDiscounts.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
