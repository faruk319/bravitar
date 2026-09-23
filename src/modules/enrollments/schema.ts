import { type AnyPgColumn, date, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { batches } from "@/modules/batches/schema";
import { students } from "@/modules/students/schema";
import { tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0010_enrollments.sql.
const app = pgSchema("app");

export const enrollments = app.table("enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  studentId: uuid("student_id").notNull().references(() => students.id),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  status: text("status", { enum: ["active", "paused", "left", "transferred"] }).notNull().default("active"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  pausedOn: date("paused_on"),
  transferredToEnrollmentId: uuid("transferred_to_enrollment_id").references((): AnyPgColumn => enrollments.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Enrollment = typeof enrollments.$inferSelect;
