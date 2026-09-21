import { boolean, customType, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branches, tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0004_staff_and_rbac.sql.
const app = pgSchema("app");
const citext = customType<{ data: string }>({ dataType: () => "extensions.citext" });

// password_hash sentinel for "no password set yet"; login is impossible with it.
export const PASSWORD_UNSET = "!";

export const permissions = app.table("permissions", {
  key: text("key").primaryKey(),
  module: text("module").notNull(),
  description: text("description").notNull(),
});

export const staffUsers = app.table("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  email: citext("email").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  isOwner: boolean("is_owner").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const staffBranches = app.table(
  "staff_branches",
  {
    staffId: uuid("staff_id").notNull().references(() => staffUsers.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.branchId] })],
);

export const roles = app.table("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = app.table(
  "role_permissions",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    permissionKey: text("permission_key").notNull().references(() => permissions.key),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const staffRoles = app.table(
  "staff_roles",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    staffId: uuid("staff_id").notNull().references(() => staffUsers.id),
    roleId: uuid("role_id").notNull().references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.roleId] })],
);

export type StaffUser = typeof staffUsers.$inferSelect;
export type Role = typeof roles.$inferSelect;
