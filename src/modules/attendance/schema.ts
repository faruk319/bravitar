import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sessions } from "@/modules/sessions/schema";
import { staffUsers } from "@/modules/staff/schema";
import { students } from "@/modules/students/schema";
import { tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0011_attendance.sql.
const app = pgSchema("app");

export const MARKS = ["present", "absent", "late", "excused"] as const;
export type Mark = (typeof MARKS)[number];

export const attendance = app.table("attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  studentId: uuid("student_id").notNull().references(() => students.id),
  status: text("status", { enum: MARKS }).notNull(),
  markedBy: uuid("marked_by").references(() => staffUsers.id),
  markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source", { enum: ["staff", "offline_sync", "portal", "kiosk"] }).notNull().default("staff"),
  note: text("note"),
});

export type AttendanceRow = typeof attendance.$inferSelect;
