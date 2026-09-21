import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AccessContext, assertCan, can, ForbiddenError } from "@/lib/auth/can";
import { PERMISSION_KEYS, PRESET_ROLES } from "@/lib/auth/permissions";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { countActiveOwners, listRoles, rolePermissionKeys, staffRoleIds } from "@/modules/staff/repo";
import type { Role, StaffUser } from "@/modules/staff/schema";
import {
  createStaffMember,
  deactivateStaff,
  LastOwnerError,
  loadAccessContext,
  RoleNotEditableError,
  setOwner,
  setRolePermissions,
  setStaffRoles,
} from "@/modules/staff/service";
import { tenants } from "@/modules/tenancy/schema";
import { createTenantWithDefaults } from "@/modules/tenancy/service";

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let owner: StaffUser;
let roles: Record<string, Role> = {};
let teacher: StaffUser;
let frontDesk: StaffUser;
let dual: StaffUser;

const ctxOf = (staffId: string) => withTenant(T, (tx) => loadAccessContext(tx, staffId));

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const created = await createTenantWithDefaults(
    { actorType: "system" },
    { name: `Staff Test ${stamp}`, slug: `staff-${stamp}`, verticalPreset: "karate", owner: { name: "Owner One", email: `owner-${stamp}@example.test` } },
  );
  T = created.tenant.id;
  owner = created.owner;
  roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r]));
  const ownerCtx = await ctxOf(owner.id);
  [teacher, frontDesk, dual] = await withTenant(T, async (tx) => [
    await createStaffMember(tx, ownerCtx, { email: `teacher-${stamp}@example.test`, fullName: "Teacher", roleIds: [roles.Teacher?.id ?? ""] }),
    await createStaffMember(tx, ownerCtx, { email: `desk-${stamp}@example.test`, fullName: "Front Desk", roleIds: [roles["Front Desk"]?.id ?? ""] }),
    await createStaffMember(tx, ownerCtx, { email: `dual-${stamp}@example.test`, fullName: "Dual", roleIds: [roles.Teacher?.id ?? "", roles["Front Desk"]?.id ?? ""] }),
  ]);
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("tenant creation (docs/03 §1)", () => {
  it("creates the four preset roles with their permission sets and an owner holding the Owner role", async () => {
    expect(Object.keys(roles).sort()).toEqual(["Front Desk", "Manager", "Owner", "Teacher"]);
    expect(roles.Owner?.isSystem).toBe(true);
    const counts = await withTenant(T, async (tx) => ({
      owner: (await rolePermissionKeys(tx, roles.Owner?.id ?? "")).length,
      manager: (await rolePermissionKeys(tx, roles.Manager?.id ?? "")).length,
      teacher: (await rolePermissionKeys(tx, roles.Teacher?.id ?? "")).length,
      frontDesk: (await rolePermissionKeys(tx, roles["Front Desk"]?.id ?? "")).length,
      ownerRoles: await staffRoleIds(tx, owner.id),
    }));
    expect(counts).toMatchObject({ owner: 0, manager: PERMISSION_KEYS.length - 3, teacher: 4, frontDesk: 12 });
    expect(counts.ownerRoles).toEqual([roles.Owner?.id]);
  });
});

describe("owner bypass", () => {
  it("an owner with no permission rows can do everything, in any module", async () => {
    const ctx = await ctxOf(owner.id);
    expect(ctx.isOwner).toBe(true);
    expect(ctx.permissions).toEqual([]);
    expect(can(ctx, "fees", "fees:refund")).toBe(true);
    expect(can(ctx, "credits", "credits:manage")).toBe(true);
    expect(() => assertCan(ctx, "integrations:manage")).not.toThrow();
  });
});

describe("multi-role union", () => {
  it("a staff member with two roles gets the union of their permissions", async () => {
    const ctx = await ctxOf(dual.id);
    const expected = [...new Set([...PRESET_ROLES.Teacher.permissions, ...PRESET_ROLES["Front Desk"].permissions])].sort();
    expect(ctx.permissions).toEqual(expected);
    expect(can(ctx, "batches", "sessions:note")).toBe(true); // Teacher only
    expect(can(ctx, "enquiries", "enquiries:create")).toBe(true); // Front Desk only
    expect(can(ctx, "fees", "fees:refund")).toBe(false); // neither
  });
});

describe("module flag", () => {
  it("disabling a module blocks a permitted action, keeps role rows intact, and re-enabling restores it exactly", async () => {
    const rowsBefore = await withTenant(T, (tx) => rolePermissionKeys(tx, roles["Front Desk"]?.id ?? ""));
    expect(rowsBefore).toContain("enquiries:create");
    expect(can(await ctxOf(frontDesk.id), "enquiries", "enquiries:create")).toBe(true);

    const setModule = (enabled: boolean) =>
      withPlatformAdmin({ action: "tenant.modules.set", actorType: "system", tenantId: T }, async (tx) => {
        const [t] = await tx.select({ m: tenants.enabledModules }).from(tenants).where(eq(tenants.id, T));
        await tx.update(tenants).set({ enabledModules: { ...t?.m, enquiries: enabled } }).where(eq(tenants.id, T));
      });

    await setModule(false);
    const blocked = await ctxOf(frontDesk.id);
    expect(blocked.permissions).toContain("enquiries:create");
    expect(can(blocked, "enquiries", "enquiries:create")).toBe(false);
    expect(() => assertCan(blocked, "enquiries:create")).toThrow(ForbiddenError);
    expect(can(blocked, "students", "students:create")).toBe(true);
    expect(await withTenant(T, (tx) => rolePermissionKeys(tx, roles["Front Desk"]?.id ?? ""))).toEqual(rowsBefore);

    await setModule(true);
    expect(can(await ctxOf(frontDesk.id), "enquiries", "enquiries:create")).toBe(true);
    expect(await withTenant(T, (tx) => rolePermissionKeys(tx, roles["Front Desk"]?.id ?? ""))).toEqual(rowsBefore);
  });
});

describe("service-layer gate", () => {
  it("a Teacher is refused fees:collect with a 403 and allowed attendance:mark", async () => {
    const ctx = await ctxOf(teacher.id);
    expect(() => assertCan(ctx, "attendance:mark")).not.toThrow();
    let err: unknown;
    try {
      assertCan(ctx, "fees:collect");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).status).toBe(403);
  });

  it("staff without staff:manage cannot manage staff or roles", async () => {
    const ctx = await ctxOf(frontDesk.id);
    await expect(withTenant(T, (tx) => createStaffMember(tx, ctx, { email: `x-${stamp}@example.test`, fullName: "X" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTenant(T, (tx) => setRolePermissions(tx, ctx, roles.Teacher?.id ?? "", ["fees:refund"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("role permission override", () => {
  it("edits a preset role per permission, refuses the Owner role and unknown keys, and audits the change", async () => {
    const ctx = await ctxOf(owner.id);
    const teacherRole = roles.Teacher?.id ?? "";
    await expect(withTenant(T, (tx) => setRolePermissions(tx, ctx, roles.Owner?.id ?? "", ["staff:read"]))).rejects.toBeInstanceOf(RoleNotEditableError);
    await expect(withTenant(T, (tx) => setRolePermissions(tx, ctx, teacherRole, ["fees:steal"]))).rejects.toThrow(/Unknown permission/);

    const keys = await withTenant(T, (tx) => setRolePermissions(tx, ctx, teacherRole, [...PRESET_ROLES.Teacher.permissions, "attendance:amend", "attendance:amend"]));
    expect(keys).toEqual([...new Set([...PRESET_ROLES.Teacher.permissions, "attendance:amend"])].sort());
    expect(can(await ctxOf(teacher.id), "attendance", "attendance:amend")).toBe(true);

    const audit = await withTenant(T, (tx) => tx.select({ action: auditLog.action, actorId: auditLog.actorId, after: auditLog.after }).from(auditLog).where(eq(auditLog.entityId, teacherRole)));
    expect(audit).toEqual([{ action: "role.permissions.set", actorId: owner.id, after: { keys } }]);
  });
});

describe("last owner", () => {
  it("refuses to demote or deactivate the only active owner, then allows it once another owner exists", async () => {
    const ctx = await ctxOf(owner.id);
    expect(await withTenant(T, (tx) => countActiveOwners(tx, T))).toBe(1);
    await expect(withTenant(T, (tx) => setOwner(tx, ctx, owner.id, false))).rejects.toBeInstanceOf(LastOwnerError);
    await expect(withTenant(T, (tx) => deactivateStaff(tx, ctx, owner.id))).rejects.toBeInstanceOf(LastOwnerError);
    await expect(withTenant(T, (tx) => setOwner(tx, ctx, owner.id, false))).rejects.toThrow(/at least one active owner/);

    await withTenant(T, (tx) => setOwner(tx, ctx, teacher.id, true));
    expect(await withTenant(T, (tx) => countActiveOwners(tx, T))).toBe(2);
    await withTenant(T, (tx) => setOwner(tx, ctx, owner.id, false));
    expect((await ctxOf(owner.id)).isOwner).toBe(false);

    // Now the teacher is the only owner: refuse again, from the teacher's own context.
    const teacherCtx = await ctxOf(teacher.id);
    await expect(withTenant(T, (tx) => deactivateStaff(tx, teacherCtx, teacher.id))).rejects.toBeInstanceOf(LastOwnerError);
    await withTenant(T, (tx) => setOwner(tx, teacherCtx, owner.id, true)); // restore
  });

  it("reassigning roles replaces the union with the new roles' current keys", async () => {
    const ctx: AccessContext = await ctxOf(owner.id);
    expect(ctx.isOwner).toBe(true);
    await withTenant(T, (tx) => setStaffRoles(tx, ctx, dual.id, [roles.Teacher?.id ?? ""]));
    const teacherKeys = await withTenant(T, (tx) => rolePermissionKeys(tx, roles.Teacher?.id ?? ""));
    expect((await ctxOf(dual.id)).permissions).toEqual(teacherKeys);
    expect(teacherKeys).toContain("attendance:amend"); // added by the override test above
  });
});
