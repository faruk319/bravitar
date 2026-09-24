import { bigint, date, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { invoices } from "@/modules/fees/schema";
import { staffUsers } from "@/modules/staff/schema";
import { households } from "@/modules/students/schema";
import { branches, tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0015_payments.sql. Money is bigint paise. Rows are only
// ever added: the database refuses updates to a payment's amount, method, dates
// and number, and to any allocation or refund (docs/03 §9).
const app = pgSchema("app");
const paise = (name: string) => bigint(name, { mode: "bigint" });

export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "card", "online"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["pending", "confirmed", "failed", "refunded", "cancelled"] as const;

// receipt/advance put money on an invoice; refund/void/cancel take it back (negative).
export const ALLOCATION_KINDS = ["receipt", "advance", "refund", "void", "cancel"] as const;
export type AllocationKind = (typeof ALLOCATION_KINDS)[number];

export const payments = app.table("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  householdId: uuid("household_id").notNull().references(() => households.id),
  requestId: uuid("request_id"),
  receiptNumber: text("receipt_number").notNull(),
  fy: text("fy").notNull(),
  method: text("method", { enum: PAYMENT_METHODS }).notNull(),
  amountPaise: paise("amount_paise").notNull(),
  receivedOn: date("received_on").notNull(),
  recordedOn: date("recorded_on").notNull(),
  receivedBy: uuid("received_by").references(() => staffUsers.id),
  reference: text("reference"),
  gatewayPaymentId: text("gateway_payment_id"),
  notes: text("notes"),
  status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("confirmed"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => staffUsers.id),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refunds = app.table("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  amountPaise: paise("amount_paise").notNull(),
  method: text("method", { enum: PAYMENT_METHODS }).notNull(),
  reference: text("reference"),
  reason: text("reason").notNull(),
  refundedOn: date("refunded_on").notNull(),
  approvedBy: uuid("approved_by").references(() => staffUsers.id),
  refundedAt: timestamp("refunded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentAllocations = app.table("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  kind: text("kind", { enum: ALLOCATION_KINDS }).notNull(),
  amountPaise: paise("amount_paise").notNull(),
  refundId: uuid("refund_id").references(() => refunds.id),
  createdBy: uuid("created_by").references(() => staffUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payment = typeof payments.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
