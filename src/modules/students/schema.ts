import { boolean, customType, date, inet, integer, jsonb, pgSchema, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branches, tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0006_students.sql.
const app = pgSchema("app");
const citext = customType<{ data: string }>({ dataType: () => "extensions.citext" });

export const STUDENT_STATUSES = ["active", "paused", "left", "prospect"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const LEFT_REASONS = ["moved_away", "fees", "timing", "lost_interest", "completed", "health", "other"] as const;
export type LeftReason = (typeof LEFT_REASONS)[number];
export const LEFT_REASON_LABELS: Record<LeftReason, string> = {
  moved_away: "Moved away",
  fees: "Fees",
  timing: "Timing",
  lost_interest: "Lost interest",
  completed: "Completed",
  health: "Health",
  other: "Other",
};

export const RELATIONS = ["father", "mother", "self", "other"] as const;
export type Relation = (typeof RELATIONS)[number];

export const CONSENT_KINDS = ["data_processing", "photo", "medical", "waiver"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export type StudentMetadata = { programInterest?: string } & Record<string, unknown>;

export const households = app.table("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  address: text("address"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const guardians = app.table("guardians", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  householdId: uuid("household_id").notNull().references(() => households.id),
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull(),
  email: citext("email"),
  canLogin: boolean("can_login").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false),
  whatsappOptin: boolean("whatsapp_optin").notNull().default(false), // automated messages only after this
  whatsappOptinAt: timestamp("whatsapp_optin_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const students = app.table("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  householdId: uuid("household_id").notNull().references(() => households.id),
  code: text("code").notNull(),
  codeEditedAt: timestamp("code_edited_at", { withTimezone: true }),
  fullName: text("full_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  phone: text("phone"),
  photoKey: text("photo_key"),
  status: text("status", { enum: STUDENT_STATUSES }).notNull().default("active"),
  joinedOn: date("joined_on").notNull().defaultNow(),
  leftOn: date("left_on"),
  leftReason: text("left_reason", { enum: LEFT_REASONS }),
  leftNote: text("left_note"),
  metadata: jsonb("metadata").$type<StudentMetadata>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const studentGuardians = app.table(
  "student_guardians",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    studentId: uuid("student_id").notNull().references(() => students.id),
    guardianId: uuid("guardian_id").notNull().references(() => guardians.id),
    relation: text("relation", { enum: RELATIONS }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.guardianId] })],
);

export const consents = app.table("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  studentId: uuid("student_id").notNull().references(() => students.id),
  guardianId: uuid("guardian_id").references(() => guardians.id),
  kind: text("kind", { enum: CONSENT_KINDS }).notNull(),
  granted: boolean("granted").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  grantedIp: inet("granted_ip"),
  method: text("method", { enum: ["portal", "paper", "staff_recorded"] }).notNull(),
  documentKey: text("document_key"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const studentCodeSeries = app.table(
  "student_code_series",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    year: smallint("year").notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })],
);

export type Household = typeof households.$inferSelect;
export type Guardian = typeof guardians.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Consent = typeof consents.$inferSelect;
