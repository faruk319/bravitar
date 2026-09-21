import { eq } from "drizzle-orm";
import { z } from "zod";
import { type AccessContext, assertCan, assertKnownPermission, moduleFlags } from "@/lib/auth/can";
import { type PermissionKey, PRESET_ROLE_NAMES, PRESET_ROLES, type PresetRoleName } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { tenants } from "@/modules/tenancy/schema";
import {
  countActiveOwners,
  createRole,
  createStaff,
  getRole,
  getStaff,
  permissionKeysForStaff,
  replaceRolePermissions,
  replaceStaffBranches,
  replaceStaffRoles,
  rolePermissionKeys,
  staffRoleIds,
  updateStaff,
} from "./repo";
import { PASSWORD_UNSET, type Role, type StaffUser } from "./schema";

type AnyTx = Tx | PlatformTx;

export class LastOwnerError extends ConflictError {
  constructor() {
    super("Every academy needs at least one active owner. Make someone else an owner first.");
  }
}

export class RoleNotEditableError extends AppError {
  constructor(name: string) {
    super(`The ${name} role cannot be edited`, 409);
  }
}

// docs/03 §2 presets, created with the tenant.
export async function createPresetRoles(tx: AnyTx, tenantId: string): Promise<Record<PresetRoleName, Role>> {
  const out = {} as Record<PresetRoleName, Role>;
  for (const name of PRESET_ROLE_NAMES) {
    const preset = PRESET_ROLES[name];
    const role = await createRole(tx, { tenantId, name, isSystem: preset.isSystem });
    await replaceRolePermissions(tx, tenantId, role.id, preset.permissions);
    out[name] = role;
  }
  return out;
}

// The context every service call is gated on. From the auth slice on this is
// built at login and cached on the session row.
export async function loadAccessContext(tx: AnyTx, staffId: string): Promise<AccessContext> {
  const staff = await getStaff(tx, staffId);
  if (!staff || !staff.isActive) throw new NotFoundError("Active staff member");
  const [tenant] = await tx.select({ enabledModules: tenants.enabledModules }).from(tenants).where(eq(tenants.id, staff.tenantId));
  if (!tenant) throw new NotFoundError("Tenant");
  return {
    tenantId: staff.tenantId,
    staffId: staff.id,
    isOwner: staff.isOwner,
    modules: moduleFlags(tenant.enabledModules),
    permissions: await permissionKeysForStaff(tx, staff.id),
  };
}

const staffInputSchema = z.object({
  email: z.email().trim().toLowerCase(),
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(20).optional(),
  roleIds: z.array(z.uuid()).default([]),
  branchIds: z.array(z.uuid()).default([]),
});
export type NewStaffInput = z.input<typeof staffInputSchema>;

// Created without a password; the invite / set-password flow sets one.
export async function createStaffMember(tx: Tx, ctx: AccessContext, input: NewStaffInput): Promise<StaffUser> {
  assertCan(ctx, "staff:manage");
  const data = staffInputSchema.parse(input);
  const staff = await createStaff(tx, {
    tenantId: ctx.tenantId,
    email: data.email,
    fullName: data.fullName,
    passwordHash: PASSWORD_UNSET,
    ...(data.phone !== undefined ? { phone: data.phone } : {}),
  });
  await replaceStaffRoles(tx, ctx.tenantId, staff.id, data.roleIds);
  await replaceStaffBranches(tx, ctx.tenantId, staff.id, data.branchIds);
  await writeAudit(tx, { ...actor(ctx), action: "staff.create", entityType: "staff_user", entityId: staff.id, after: { email: data.email, roleIds: data.roleIds } });
  return staff;
}

export async function setStaffRoles(tx: Tx, ctx: AccessContext, staffId: string, roleIds: string[]): Promise<void> {
  assertCan(ctx, "staff:manage");
  await requireStaff(tx, staffId);
  for (const id of roleIds) if (!(await getRole(tx, id))) throw new NotFoundError("Role");
  const before = await staffRoleIds(tx, staffId);
  await replaceStaffRoles(tx, ctx.tenantId, staffId, roleIds);
  await writeAudit(tx, { ...actor(ctx), action: "staff.roles.set", entityType: "staff_user", entityId: staffId, before: { roleIds: before }, after: { roleIds } });
  // TODO(auth slice): invalidate this staff member's cached session context.
}

export async function setOwner(tx: Tx, ctx: AccessContext, staffId: string, isOwner: boolean): Promise<StaffUser> {
  assertCan(ctx, "staff:manage");
  const staff = await requireStaff(tx, staffId);
  if (staff.isOwner && !isOwner) await ensureNotLastOwner(tx, ctx.tenantId);
  const updated = await updateStaff(tx, staffId, { isOwner });
  await writeAudit(tx, { ...actor(ctx), action: "staff.owner.set", entityType: "staff_user", entityId: staffId, before: { isOwner: staff.isOwner }, after: { isOwner } });
  return updated;
}

export async function deactivateStaff(tx: Tx, ctx: AccessContext, staffId: string): Promise<StaffUser> {
  assertCan(ctx, "staff:manage");
  const staff = await requireStaff(tx, staffId);
  if (staff.isOwner && staff.isActive) await ensureNotLastOwner(tx, ctx.tenantId);
  const updated = await updateStaff(tx, staffId, { isActive: false });
  await writeAudit(tx, { ...actor(ctx), action: "staff.deactivate", entityType: "staff_user", entityId: staffId });
  // TODO(auth slice): revoke every session of this staff member immediately.
  return updated;
}

// Per-permission override on a non-system preset role (V1: no new roles).
export async function setRolePermissions(tx: Tx, ctx: AccessContext, roleId: string, keys: string[]): Promise<PermissionKey[]> {
  assertCan(ctx, "staff:manage");
  const role = await getRole(tx, roleId);
  if (!role) throw new NotFoundError("Role");
  if (role.isSystem) throw new RoleNotEditableError(role.name);
  const valid = [...new Set(keys.map(assertKnownPermission))].sort();
  const before = await rolePermissionKeys(tx, roleId);
  await replaceRolePermissions(tx, ctx.tenantId, roleId, valid);
  await writeAudit(tx, { ...actor(ctx), action: "role.permissions.set", entityType: "role", entityId: roleId, before: { keys: before }, after: { keys: valid } });
  // TODO(auth slice): invalidate the cached context of every holder of this role.
  return valid;
}

async function requireStaff(tx: Tx, staffId: string): Promise<StaffUser> {
  const staff = await getStaff(tx, staffId);
  if (!staff) throw new NotFoundError("Staff member");
  return staff;
}

async function ensureNotLastOwner(tx: Tx, tenantId: string): Promise<void> {
  if ((await countActiveOwners(tx, tenantId)) <= 1) throw new LastOwnerError();
}

function actor(ctx: AccessContext) {
  return { actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId };
}
