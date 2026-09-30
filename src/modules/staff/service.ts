import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type AccessContext, assertCan, assertKnownPermission, moduleFlags } from "@/lib/auth/can";
import { type PermissionKey, PRESET_ROLE_NAMES, PRESET_ROLES, type PresetRoleName } from "@/lib/auth/permissions";
import { hashPassword, passwordSchema } from "@/lib/auth/password";
import { hashToken, newToken } from "@/lib/auth/token";
import { writeAudit } from "@/lib/db/audit";
import { db, type Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { AppError, BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { phoneSchema } from "@/lib/phone";
import { invalidateSessionsForRoleHolders, invalidateSessionsForStaff, revokeSessionsForStaff } from "@/modules/auth/repo";
import { assertStaffRoom } from "@/modules/billing/access";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { tenants } from "@/modules/tenancy/schema";
import {
  allRolePermissions,
  countActiveOwners,
  createRole,
  createStaff,
  deleteRoleRow,
  expireInvites,
  getRole,
  getStaff,
  insertInvite,
  listRoles,
  listStaff,
  markInviteUsed,
  permissionKeysForStaff,
  renameRoleRow,
  replaceRolePermissions,
  replaceStaffBranches,
  replaceStaffRoles,
  roleHolderCounts,
  rolePermissionKeys,
  staffBranchLinks,
  staffRoleIds,
  staffRoleLinks,
  staffWithOpenInvites,
  updateStaff,
  updateStaffPassword,
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
  phone: phoneSchema.optional(),
  roleIds: z.array(z.uuid()).default([]),
  branchIds: z.array(z.uuid()).default([]),
});
export type NewStaffInput = z.input<typeof staffInputSchema>;

// Created without a password; the invite / set-password flow sets one.
export async function createStaffMember(tx: Tx, ctx: AccessContext, input: NewStaffInput): Promise<StaffUser> {
  assertCan(ctx, "staff:manage");
  const data = staffInputSchema.parse(input);
  await assertStaffRoom(tx, ctx);
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
  await invalidateSessionsForStaff(tx, staffId);
}

export async function setStaffBranches(tx: Tx, ctx: AccessContext, staffId: string, branchIds: string[]): Promise<void> {
  assertCan(ctx, "staff:manage");
  await requireStaff(tx, staffId);
  await replaceStaffBranches(tx, ctx.tenantId, staffId, branchIds);
  await writeAudit(tx, { ...actor(ctx), action: "staff.branches.set", entityType: "staff_user", entityId: staffId, after: { branchIds } });
  await invalidateSessionsForStaff(tx, staffId);
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
  await revokeSessionsForStaff(tx, staffId);
  return updated;
}

// Tick-and-save on any role except the system Owner role.
export async function setRolePermissions(tx: Tx, ctx: AccessContext, roleId: string, keys: string[]): Promise<PermissionKey[]> {
  assertCan(ctx, "staff:manage");
  const role = await getRole(tx, roleId);
  if (!role) throw new NotFoundError("Role");
  if (role.isSystem) throw new RoleNotEditableError(role.name);
  const valid = [...new Set(keys.map(assertKnownPermission))].sort();
  const before = await rolePermissionKeys(tx, roleId);
  await replaceRolePermissions(tx, ctx.tenantId, roleId, valid);
  await writeAudit(tx, { ...actor(ctx), action: "role.permissions.set", entityType: "role", entityId: roleId, before: { keys: before }, after: { keys: valid } });
  await invalidateSessionsForRoleHolders(tx, roleId);
  return valid;
}

async function requireEditableRole(tx: Tx, id: string): Promise<Role> {
  const role = await getRole(tx, id);
  if (!role) throw new NotFoundError("Role");
  if (role.isSystem) throw new RoleNotEditableError(role.name);
  return role;
}

const roleName = z.string().trim().min(2, "Give the role a name").max(40);

// Custom roles (agreed 2026-09-23): any name, optionally starting from another role's ticks.
export async function addRole(tx: Tx, ctx: AccessContext, input: { name: string; copyFrom?: string | undefined }): Promise<Role> {
  assertCan(ctx, "staff:manage");
  const name = roleName.parse(input.name);
  const keys = input.copyFrom ? ((await rolePermissionKeys(tx, (await requireEditableRole(tx, input.copyFrom)).id)) as PermissionKey[]) : [];
  let role: Role;
  try {
    role = await createRole(tx, { tenantId: ctx.tenantId, name });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`A role called "${name}" already exists`);
    throw e;
  }
  await replaceRolePermissions(tx, ctx.tenantId, role.id, keys);
  await writeAudit(tx, { ...actor(ctx), action: "role.create", entityType: "role", entityId: role.id, after: { name, keys } });
  return role;
}

export async function renameRole(tx: Tx, ctx: AccessContext, id: string, name: string): Promise<Role> {
  assertCan(ctx, "staff:manage");
  const role = await requireEditableRole(tx, id);
  const next = roleName.parse(name);
  try {
    const after = await renameRoleRow(tx, id, next);
    await writeAudit(tx, { ...actor(ctx), action: "role.rename", entityType: "role", entityId: id, before: { name: role.name }, after: { name: next } });
    return after;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`A role called "${next}" already exists`);
    throw e;
  }
}

// Refused while active staff hold it; nobody loses access by surprise.
export async function removeRole(tx: Tx, ctx: AccessContext, id: string): Promise<void> {
  assertCan(ctx, "staff:manage");
  const role = await requireEditableRole(tx, id);
  const holders = (await roleHolderCounts(tx)).get(id) ?? 0;
  if (holders) throw new ConflictError(`Remove it from ${holders} staff first`);
  const keys = await rolePermissionKeys(tx, id);
  await deleteRoleRow(tx, id);
  await writeAudit(tx, { ...actor(ctx), action: "role.delete", entityType: "role", entityId: id, before: { name: role.name, keys } });
}

export type RoleView = Role & { keys: string[]; holders: number };

export async function roleViews(tx: Tx, ctx: AccessContext): Promise<RoleView[]> {
  assertCan(ctx, "staff:read");
  const [list, keys, holders] = await Promise.all([listRoles(tx), allRolePermissions(tx), roleHolderCounts(tx)]);
  return list.map((r) => ({ ...r, keys: keys.get(r.id) ?? [], holders: holders.get(r.id) ?? 0 }));
}

export type StaffStatus = "active" | "invited" | "needs-link" | "off";
export type StaffRow = StaffUser & { roleIds: string[]; branchIds: string[]; status: StaffStatus };

export async function staffDirectory(tx: Tx, ctx: AccessContext, now = new Date()): Promise<StaffRow[]> {
  assertCan(ctx, "staff:read");
  const [list, roleLinks, branchLinks, invited] = await Promise.all([listStaff(tx), staffRoleLinks(tx), staffBranchLinks(tx), staffWithOpenInvites(tx, now)]);
  return list.map((s) => ({
    ...s,
    roleIds: roleLinks.filter((l) => l.staffId === s.id).map((l) => l.roleId),
    branchIds: branchLinks.filter((l) => l.staffId === s.id).map((l) => l.branchId),
    status: !s.isActive ? "off" : s.passwordHash !== PASSWORD_UNSET ? "active" : invited.has(s.id) ? "invited" : "needs-link",
  }));
}

export const INVITE_DAYS = 7;

// A one-time link to set a password; older links stop working.
export async function issueInvite(tx: Tx, ctx: AccessContext, staffId: string, now = new Date()): Promise<string> {
  assertCan(ctx, "staff:manage");
  const staff = await requireStaff(tx, staffId);
  if (!staff.isActive) throw new ConflictError("Turn them back on first");
  await expireInvites(tx, staffId, now);
  const token = newToken();
  await insertInvite(tx, { tenantId: ctx.tenantId, staffId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000), createdBy: ctx.staffId });
  await writeAudit(tx, { ...actor(ctx), action: "staff.invite", entityType: "staff_user", entityId: staffId });
  return token;
}

export async function addStaff(tx: Tx, ctx: AccessContext, input: NewStaffInput, now = new Date()): Promise<{ staff: StaffUser; token: string }> {
  let staff: StaffUser;
  try {
    staff = await createStaffMember(tx, ctx, input);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("That email is already on the staff list");
    throw e;
  }
  return { staff, token: await issueInvite(tx, ctx, staff.id, now) };
}

export async function reactivateStaff(tx: Tx, ctx: AccessContext, staffId: string): Promise<StaffUser> {
  assertCan(ctx, "staff:manage");
  if (!(await requireStaff(tx, staffId)).isActive) await assertStaffRoom(tx, ctx);
  const updated = await updateStaff(tx, staffId, { isActive: true });
  await writeAudit(tx, { ...actor(ctx), action: "staff.reactivate", entityType: "staff_user", entityId: staffId });
  return updated;
}

type InviteRow = { id: string; tenant_id: string; staff_id: string; expires_at: Date; used_at: Date | null };

// The invite page has no tenant yet: the SECURITY DEFINER lookup finds it by hash.
async function findInvite(token: string): Promise<InviteRow | undefined> {
  const [row] = await db.execute<InviteRow>(sql`SELECT * FROM app.invite_by_token_hash(${hashToken(token)})`);
  return row;
}

export type InviteInfo = { ok: true; staffName: string; email: string; academy: string } | { ok: false; reason: "invalid" | "used" | "expired" };

export async function inviteInfo(token: string, now = new Date()): Promise<InviteInfo> {
  const inv = await findInvite(token);
  if (!inv) return { ok: false, reason: "invalid" };
  if (inv.used_at) return { ok: false, reason: "used" };
  if (new Date(inv.expires_at) <= now) return { ok: false, reason: "expired" };
  return withTenant(inv.tenant_id, async (tx) => {
    const [staff, tenant] = [await getStaff(tx, inv.staff_id), await getOwnTenant(tx)];
    if (!staff?.isActive || !tenant) return { ok: false, reason: "invalid" } as const;
    return { ok: true, staffName: staff.fullName, email: staff.email, academy: tenant.name } as const;
  });
}

// Sets the password, uses up the link and signs the person out everywhere.
export async function acceptInvite(token: string, password: string, now = new Date()): Promise<void> {
  const pw = passwordSchema.parse(password);
  const inv = await findInvite(token);
  if (!inv || inv.used_at || new Date(inv.expires_at) <= now) throw new BadRequestError("This link has expired or was already used. Ask for a new one.");
  const hash = await hashPassword(pw);
  await withTenant(inv.tenant_id, async (tx) => {
    const staff = await getStaff(tx, inv.staff_id);
    if (!staff?.isActive) throw new BadRequestError("This link is no longer valid");
    if (!(await markInviteUsed(tx, inv.id, now))) throw new BadRequestError("This link was already used");
    await updateStaffPassword(tx, staff.id, hash);
    await revokeSessionsForStaff(tx, staff.id);
    await writeAudit(tx, { actorType: "staff", actorId: staff.id, tenantId: inv.tenant_id, action: "staff.invite.accept", entityType: "staff_user", entityId: staff.id });
  });
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
