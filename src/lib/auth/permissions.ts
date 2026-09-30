// The permission catalog, derived from the modules in docs/03-module-specs.md.
// Keys are module:action. `module` is the enabled_modules flag a key belongs
// to; `core` is always on. This file is the source of truth: syncPermissions()
// copies it into app.permissions, and role_permissions can only reference it.

export const MODULES = ["core", "students", "enquiries", "batches", "attendance", "fees", "messaging", "reports"] as const;
export type Module = (typeof MODULES)[number];

// Modules that are never behind a tenant feature flag.
export const CORE_MODULES: readonly Module[] = ["core"];

export const PERMISSIONS = {
  "staff:read": { module: "core", description: "See staff members and their roles" },
  "staff:manage": { module: "core", description: "Add, deactivate and assign roles to staff; edit role permissions" },
  "settings:manage": { module: "core", description: "Edit academy profile, branches and labels" },
  "integrations:manage": { module: "core", description: "Connect Razorpay and WhatsApp" },
  "audit:read": { module: "core", description: "View the academy audit log" },
  "billing:view": { module: "core", description: "See Bravitar's bills for this academy" },
  "billing:manage": { module: "core", description: "Turn activities on or off in a branch" },

  "students:read": { module: "students", description: "See students in assigned batches and branches" },
  "students:read_all": { module: "students", description: "See every student regardless of coach assignment" },
  "students:create": { module: "students", description: "Add students, households and guardians" },
  "students:update": { module: "students", description: "Edit student details, status and consents" },
  "students:import": { module: "students", description: "Import students from CSV" },

  "enquiries:read": { module: "enquiries", description: "See the enquiry board" },
  "enquiries:create": { module: "enquiries", description: "Add enquiries" },
  "enquiries:update": { module: "enquiries", description: "Update enquiry status, follow-ups and trials" },
  "enquiries:convert": { module: "enquiries", description: "Convert an enquiry into a student" },

  "programs:manage": { module: "batches", description: "Create and edit programs" },
  "batches:read": { module: "batches", description: "See batches, schedules and rosters" },
  "batches:manage": { module: "batches", description: "Create, edit and close batches and holidays" },
  "sessions:read": { module: "batches", description: "See sessions" },
  "sessions:note": { module: "batches", description: "Write what was taught in a session" },
  "sessions:manage": { module: "batches", description: "Cancel or reschedule sessions, assign a substitute" },
  "enrollments:manage": { module: "batches", description: "Enroll, pause, transfer and remove students in batches" },

  "attendance:read": { module: "attendance", description: "See attendance records and the monthly grid" },
  "attendance:mark": { module: "attendance", description: "Mark attendance and correct it within 48 hours" },
  "attendance:amend": { module: "attendance", description: "Change attendance after the 48-hour window" },

  "fee_plans:manage": { module: "fees", description: "Create and edit fee plans and discounts" },
  "invoices:read": { module: "fees", description: "See invoices and dues" },
  "invoices:manage": { module: "fees", description: "Generate, edit, void invoices and assign discounts" },
  "fees:collect": { module: "fees", description: "Record payments and issue receipts" },
  "fees:refund": { module: "fees", description: "Refund a payment" },
  "payments:read": { module: "fees", description: "See payments, receipts and the collection sheet" },

  "messages:read": { module: "messaging", description: "See the message log" },
  "messages:send": { module: "messaging", description: "Send messages and reminders" },
  "messages:manage": { module: "messaging", description: "Edit templates and messaging settings" },

  "reports:view": { module: "reports", description: "See the dashboard and reports" },
  "reports:export": { module: "reports", description: "Export reports as CSV" },
} as const satisfies Record<string, { module: Module; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}

export function permissionsFor(module: Module): PermissionKey[] {
  return PERMISSION_KEYS.filter((k) => PERMISSIONS[k].module === module);
}

// docs/03 §2. Owner has no rows: access comes from staff_users.is_owner.
export const PRESET_ROLE_NAMES = ["Owner", "Manager", "Teacher", "Front Desk"] as const;
export type PresetRoleName = (typeof PRESET_ROLE_NAMES)[number];

const MANAGER_EXCLUDED: PermissionKey[] = ["staff:manage", "integrations:manage", "fees:refund", "billing:manage"];

export const PRESET_ROLES: Record<PresetRoleName, { isSystem: boolean; permissions: PermissionKey[] }> = {
  Owner: { isSystem: true, permissions: [] },
  Manager: { isSystem: false, permissions: PERMISSION_KEYS.filter((k) => !MANAGER_EXCLUDED.includes(k)) },
  Teacher: { isSystem: false, permissions: ["students:read", "sessions:read", "sessions:note", "attendance:mark"] },
  "Front Desk": {
    isSystem: false,
    permissions: [...permissionsFor("students"), ...permissionsFor("enquiries"), "enrollments:manage", "fees:collect", "invoices:read", "attendance:mark"],
  },
};
