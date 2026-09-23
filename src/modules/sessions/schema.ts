import { boolean, date, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { batches } from "@/modules/batches/schema";
import { staffUsers } from "@/modules/staff/schema";
import { branches, resources, tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0008_sessions.sql. coach_id / resource_id NULL mean the
// batch's own; a value is a one-off override (substitute, other room).
const app = pgSchema("app");

const SESSION_STATUSES = ["scheduled", "held", "cancelled"] as const;

export const sessions = app.table("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  coachId: uuid("coach_id").references(() => staffUsers.id),
  resourceId: uuid("resource_id").references(() => resources.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  sessionDate: date("session_date").notNull(),
  status: text("status", { enum: SESSION_STATUSES }).notNull().default("scheduled"),
  cancelReason: text("cancel_reason"),
  notes: text("notes"),
  generated: boolean("generated").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
