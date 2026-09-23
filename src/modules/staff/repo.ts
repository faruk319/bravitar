import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { permissions, type Role, rolePermissions, roles, staffBranches, staffInvites, staffRoles, type StaffUser, staffUsers } from "./schema";

type AnyTx = Tx | PlatformTx;

// Copies the code catalog into app.permissions. Never deletes: a key removed
// from code stays until a migration drops it, so role rows keep their FK.
export async function syncPermissions(tx: PlatformTx): Promise<void> {
  await tx
    .insert(permissions)
    .values(PERMISSION_KEYS.map((key) => ({ key, module: PERMISSIONS[key].module, description: PERMISSIONS[key].description })))
    .onConflictDoUpdate({ target: permissions.key, set: { module: sql`excluded.module`, description: sql`excluded.description` } });
}

export type CreateStaffInput = { tenantId: string; email: string; fullName: string; phone?: string; passwordHash: string; isOwner?: boolean };

export async function createStaff(tx: AnyTx, input: CreateStaffInput): Promise<StaffUser> {
  const [row] = await tx.insert(staffUsers).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("staff insert returned no row");
  return row;
}

export async function getStaff(tx: AnyTx, id: string): Promise<StaffUser | undefined> {
  const [row] = await tx.select().from(staffUsers).where(and(eq(staffUsers.id, id), isNull(staffUsers.deletedAt)));
  return row;
}

export async function listStaff(tx: Tx): Promise<StaffUser[]> {
  return tx.select().from(staffUsers).where(isNull(staffUsers.deletedAt)).orderBy(staffUsers.fullName);
}

export async function countActiveOwners(tx: AnyTx, tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.isOwner, true), eq(staffUsers.isActive, true), isNull(staffUsers.deletedAt)));
  return row?.n ?? 0;
}

export async function updateStaff(tx: Tx, id: string, patch: Partial<Pick<StaffUser, "isOwner" | "isActive" | "fullName" | "phone">>): Promise<StaffUser> {
  const [row] = await tx.update(staffUsers).set(patch).where(eq(staffUsers.id, id)).returning();
  if (!row) throw new Error("staff update matched no row");
  return row;
}

export async function updateStaffPassword(tx: Tx, id: string, passwordHash: string): Promise<void> {
  await tx.update(staffUsers).set({ passwordHash }).where(eq(staffUsers.id, id));
}

export async function createRole(tx: AnyTx, input: { tenantId: string; name: string; isSystem?: boolean }): Promise<Role> {
  const [row] = await tx.insert(roles).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("role insert returned no row");
  return row;
}

export async function getRole(tx: AnyTx, id: string): Promise<Role | undefined> {
  const [row] = await tx.select().from(roles).where(eq(roles.id, id));
  return row;
}

export async function listRoles(tx: Tx): Promise<Role[]> {
  return tx.select().from(roles).orderBy(roles.name);
}

export async function replaceRolePermissions(tx: AnyTx, tenantId: string, roleId: string, keys: PermissionKey[]): Promise<void> {
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (keys.length) await tx.insert(rolePermissions).values(keys.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
}

export async function rolePermissionKeys(tx: AnyTx, roleId: string): Promise<string[]> {
  const rows = await tx.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId)).orderBy(rolePermissions.permissionKey);
  return rows.map((r) => r.key);
}

export async function replaceStaffRoles(tx: AnyTx, tenantId: string, staffId: string, roleIds: string[]): Promise<void> {
  await tx.delete(staffRoles).where(eq(staffRoles.staffId, staffId));
  if (roleIds.length) await tx.insert(staffRoles).values(roleIds.map((roleId) => ({ tenantId, staffId, roleId })));
}

export async function replaceStaffBranches(tx: Tx, tenantId: string, staffId: string, branchIds: string[]): Promise<void> {
  await tx.delete(staffBranches).where(eq(staffBranches.staffId, staffId));
  if (branchIds.length) await tx.insert(staffBranches).values(branchIds.map((branchId) => ({ tenantId, staffId, branchId })));
}

export async function staffRoleIds(tx: AnyTx, staffId: string): Promise<string[]> {
  const rows = await tx.select({ roleId: staffRoles.roleId }).from(staffRoles).where(eq(staffRoles.staffId, staffId));
  return rows.map((r) => r.roleId);
}

export async function staffBranchIds(tx: Tx, staffId: string): Promise<string[]> {
  const rows = await tx.select({ branchId: staffBranches.branchId }).from(staffBranches).where(eq(staffBranches.staffId, staffId));
  return rows.map((r) => r.branchId);
}

// Union of every permission granted by every role the staff member holds.
export async function permissionKeysForStaff(tx: AnyTx, staffId: string): Promise<string[]> {
  const roleIds = await staffRoleIds(tx, staffId);
  if (!roleIds.length) return [];
  const rows = await tx
    .selectDistinct({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds))
    .orderBy(rolePermissions.permissionKey);
  return rows.map((r) => r.key);
}

export async function renameRoleRow(tx: Tx, id: string, name: string): Promise<Role> {
  const [r] = await tx.update(roles).set({ name }).where(eq(roles.id, id)).returning();
  if (!r) throw new Error("role update returned no row");
  return r;
}

export async function deleteRoleRow(tx: Tx, id: string): Promise<void> {
  await tx.delete(roles).where(eq(roles.id, id));
}

// Role id -> active staff holding it.
export async function roleHolderCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx
    .select({ roleId: staffRoles.roleId, n: count() })
    .from(staffRoles)
    .innerJoin(staffUsers, eq(staffUsers.id, staffRoles.staffId))
    .where(and(eq(staffUsers.isActive, true), isNull(staffUsers.deletedAt)))
    .groupBy(staffRoles.roleId);
  return new Map(rows.map((r) => [r.roleId, r.n]));
}

// Role id -> permission keys, for every role of the tenant.
export async function allRolePermissions(tx: Tx): Promise<Map<string, string[]>> {
  const rows = await tx.select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey }).from(rolePermissions);
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.roleId, [...(out.get(r.roleId) ?? []), r.key]);
  return out;
}

export async function staffRoleLinks(tx: Tx): Promise<{ staffId: string; roleId: string }[]> {
  return tx.select({ staffId: staffRoles.staffId, roleId: staffRoles.roleId }).from(staffRoles);
}

export async function staffBranchLinks(tx: Tx): Promise<{ staffId: string; branchId: string }[]> {
  return tx.select({ staffId: staffBranches.staffId, branchId: staffBranches.branchId }).from(staffBranches);
}

export async function insertInvite(tx: Tx, row: { tenantId: string; staffId: string; tokenHash: string; expiresAt: Date; createdBy: string }): Promise<void> {
  await tx.insert(staffInvites).values({ id: uuidv7(), ...row });
}

// Older links stop working when a new one is made.
export async function expireInvites(tx: Tx, staffId: string, now: Date): Promise<void> {
  await tx
    .update(staffInvites)
    .set({ expiresAt: now })
    .where(and(eq(staffInvites.staffId, staffId), isNull(staffInvites.usedAt), sql`${staffInvites.expiresAt} > ${now.toISOString()}::timestamptz`));
}

export async function markInviteUsed(tx: Tx, id: string, now: Date): Promise<boolean> {
  const rows = await tx.update(staffInvites).set({ usedAt: now }).where(and(eq(staffInvites.id, id), isNull(staffInvites.usedAt))).returning({ id: staffInvites.id });
  return rows.length === 1;
}

// Staff with a link that is still usable.
export async function staffWithOpenInvites(tx: Tx, now: Date): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ staffId: staffInvites.staffId })
    .from(staffInvites)
    .where(and(isNull(staffInvites.usedAt), sql`${staffInvites.expiresAt} > ${now.toISOString()}::timestamptz`));
  return new Set(rows.map((r) => r.staffId));
}
