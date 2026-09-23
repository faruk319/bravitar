import { boolean, date, integer, pgSchema, smallint, text, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "@/modules/staff/schema";
import { branches, resources, tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0007_programs_batches.sql.
const app = pgSchema("app");

export const programs = app.table("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const BATCH_STATUSES = ["active", "paused", "ended"] as const;

export const batches = app.table("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  programId: uuid("program_id").notNull().references(() => programs.id),
  name: text("name").notNull(),
  coachId: uuid("coach_id").references(() => staffUsers.id),
  resourceId: uuid("resource_id").references(() => resources.id),
  capacity: integer("capacity"),
  enrollmentMode: text("enrollment_mode", { enum: ["roster", "booking"] }).notNull().default("roster"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  status: text("status", { enum: BATCH_STATUSES }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const batchSchedules = app.table("batch_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  weekday: smallint("weekday").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
});

export const holidays = app.table("holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").references(() => branches.id),
  date: date("date").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Program = typeof programs.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type BatchSchedule = typeof batchSchedules.$inferSelect;
export type Holiday = typeof holidays.$inferSelect;
