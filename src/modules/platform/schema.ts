import { bigint, boolean, customType, inet, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors migrations/0024_platform_admins.sql. What academies pay Bravitar is
// in src/modules/billing.
const app = pgSchema("app");
const citext = customType<{ data: string }>({ dataType: () => "extensions.citext" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// You, in /platform. The authenticator secret is sealed by src/lib/crypto.
export const platformAdmins = app.table("platform_admins", {
  id: uuid("id").primaryKey(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: bytea("totp_secret").notNull(),
  totpLastStep: bigint("totp_last_step", { mode: "number" }).notNull().default(0),
  fullName: text("full_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformLoginAttempts = app.table("platform_login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull(),
  ip: inet("ip"),
  succeeded: boolean("succeeded").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformAdmin = typeof platformAdmins.$inferSelect;
