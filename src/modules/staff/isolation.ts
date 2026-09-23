import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createBranch } from "@/modules/tenancy/repo";
import { createRole, createStaff } from "./repo";
import { PASSWORD_UNSET, rolePermissions, staffBranches, staffInvites, staffRoles } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 8);
const staff = (tx: Parameters<IsolationFixtures[string]>[0], tenantId: string) =>
  createStaff(tx, { tenantId, email: `iso-${stamp()}@example.test`, fullName: "Iso Staff", passwordHash: PASSWORD_UNSET });
const role = (tx: Parameters<IsolationFixtures[string]>[0], tenantId: string) => createRole(tx, { tenantId, name: `Role ${uuidv7().slice(-6)}` });

// The suite syncs the permission catalog before fixtures run.
export const staffFixtures: IsolationFixtures = {
  staff_users: staff,
  roles: role,
  staff_branches: async (tx, tenantId) => {
    const [s, b] = await Promise.all([staff(tx, tenantId), createBranch(tx, { tenantId, name: `Branch ${stamp()}` })]);
    return tx.insert(staffBranches).values({ tenantId, staffId: s.id, branchId: b.id });
  },
  role_permissions: async (tx, tenantId) => {
    const r = await role(tx, tenantId);
    return tx.insert(rolePermissions).values({ tenantId, roleId: r.id, permissionKey: "staff:read" });
  },
  staff_roles: async (tx, tenantId) => {
    const [s, r] = await Promise.all([staff(tx, tenantId), role(tx, tenantId)]);
    return tx.insert(staffRoles).values({ tenantId, staffId: s.id, roleId: r.id });
  },
  staff_invites: async (tx, tenantId) => {
    const s = await staff(tx, tenantId);
    return tx.insert(staffInvites).values({ id: uuidv7(), tenantId, staffId: s.id, tokenHash: `iso-${uuidv7()}`, expiresAt: new Date(Date.now() + 86_400_000) });
  },
};
