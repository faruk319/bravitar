import { customType, date, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { MARKS } from "@/modules/attendance/schema";
import { batches, programs } from "@/modules/batches/schema";
import { sessions } from "@/modules/sessions/schema";
import { staffUsers } from "@/modules/staff/schema";
import { students } from "@/modules/students/schema";
import { branches, tenants } from "@/modules/tenancy/schema";
import { ACTIVITY_KINDS, ENQUIRY_STATUSES, LOST_REASONS, SOURCES } from "./lists";

// Mirrors migrations/0021_enquiries.sql.
const app = pgSchema("app");
const citext = customType<{ data: string }>({ dataType: () => "extensions.citext" });

export const enquiries = app.table("enquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  contactName: text("contact_name"),
  email: citext("email"),
  source: text("source", { enum: SOURCES }),
  programId: uuid("program_id").references(() => programs.id),
  batchId: uuid("batch_id").references(() => batches.id),
  status: text("status", { enum: ENQUIRY_STATUSES }).notNull().default("new"),
  lostReason: text("lost_reason", { enum: LOST_REASONS }),
  lostNote: text("lost_note"),
  ownerStaffId: uuid("owner_staff_id").references(() => staffUsers.id),
  nextFollowUp: date("next_follow_up"),
  convertedStudentId: uuid("converted_student_id").references(() => students.id),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => staffUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  contactedAt: timestamp("contacted_at", { withTimezone: true }),
  trialBookedAt: timestamp("trial_booked_at", { withTimezone: true }),
  trialDoneAt: timestamp("trial_done_at", { withTimezone: true }),
  wonAt: timestamp("won_at", { withTimezone: true }),
  lostAt: timestamp("lost_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const enquiryActivities = app.table("enquiry_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id),
  kind: text("kind", { enum: ACTIVITY_KINDS }).notNull(),
  note: text("note"),
  toStatus: text("to_status", { enum: ENQUIRY_STATUSES }),
  staffId: uuid("staff_id").references(() => staffUsers.id),
  happenedAt: timestamp("happened_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trialAttendances = app.table("trial_attendances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  trialDate: date("trial_date").notNull(),
  mark: text("mark", { enum: MARKS }),
  markedBy: uuid("marked_by").references(() => staffUsers.id),
  markedAt: timestamp("marked_at", { withTimezone: true }),
  feedback: text("feedback"),
  createdBy: uuid("created_by").references(() => staffUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export type Enquiry = typeof enquiries.$inferSelect;
export type EnquiryActivity = typeof enquiryActivities.$inferSelect;
export type TrialAttendance = typeof trialAttendances.$inferSelect;
