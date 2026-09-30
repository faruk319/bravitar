import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allows } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { getStaffSessionFromToken } from "@/lib/auth/session";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { login } from "@/modules/auth/service";
import { dashboardData } from "@/modules/dashboard/service";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { listRoles, rolePermissionKeys, staffBranchIds } from "./repo";
import {
  acceptInvite,
  addRole,
  addStaff,
  deactivateStaff,
  inviteInfo,
  issueInvite,
  loadAccessContext,
  reactivateStaff,
  removeRole,
  renameRole,
  setRolePermissions,
  setStaffRoles,
} from "./service";

const stamp = Math.random().toString(36).slice(2, 8);
const slug = `roles-${stamp}`;
const PASSWORD = "Correct-Horse-9";
let T = "";
let owner: ScopedCtx;
let manager: ScopedCtx;
const role: Record<string, string> = {};

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const hire = (name: string, roleIds: string[]) => withTenant(T, (tx) => addStaff(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleIds }));

beforeAll(async () => {
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Roles ${stamp}`, slug, verticalPreset: "karate", owner: { name: "Owner", email: `owner-${stamp}@example.test` } });
  T = t.tenant.id;
  owner = await ctxFor(t.owner.id);
  for (const r of await withTenant(T, listRoles)) role[r.name] = r.id;
  manager = await ctxFor((await hire("manager", [role.Manager ?? ""])).staff.id);
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("roles the owner makes", () => {
  it("a custom role's ticks are exactly what its holder can do; copying starts from another role", async () => {
    const accountant = await withTenant(T, (tx) => addRole(tx, owner, { name: "Accountant" }));
    await withTenant(T, (tx) => setRolePermissions(tx, owner, accountant.id, ["students:read", "invoices:read"]));
    const { staff } = await hire("accounts", [accountant.id]);
    const ctx = await ctxFor(staff.id);
    expect([...ctx.permissions].sort()).toEqual(["invoices:read", "students:read"]);
    expect([allows(ctx, "students:read"), allows(ctx, "students:create"), allows(ctx, "staff:manage")]).toEqual([true, false, false]);

    const desk2 = await withTenant(T, (tx) => addRole(tx, owner, { name: "Desk 2", copyFrom: role["Front Desk"] }));
    const [a, b] = await withTenant(T, async (tx) => [await rolePermissionKeys(tx, desk2.id), await rolePermissionKeys(tx, role["Front Desk"] ?? "")]);
    expect(a?.sort()).toEqual(b?.sort());
  });

  it("names are unique; a role in use can't be deleted; Owner is fixed; only staff:manage may edit", async () => {
    const r = await withTenant(T, (tx) => addRole(tx, owner, { name: "Coach Plus" }));
    await withTenant(T, (tx) => renameRole(tx, owner, r.id, "Senior Coach"));
    await expect(withTenant(T, (tx) => addRole(tx, owner, { name: "Senior Coach" }))).rejects.toThrow('A role called "Senior Coach" already exists');
    await expect(withTenant(T, (tx) => renameRole(tx, owner, r.id, "Teacher"))).rejects.toThrow("already exists");

    const { staff } = await hire("senior", [r.id]);
    await expect(withTenant(T, (tx) => removeRole(tx, owner, r.id))).rejects.toThrow("Remove it from 1 staff first");
    await withTenant(T, (tx) => setStaffRoles(tx, owner, staff.id, []));
    await withTenant(T, (tx) => removeRole(tx, owner, r.id));
    expect((await withTenant(T, listRoles)).some((x) => x.id === r.id)).toBe(false);

    const ownerRole = role.Owner ?? "";
    await expect(withTenant(T, (tx) => setRolePermissions(tx, owner, ownerRole, []))).rejects.toMatchObject({ status: 409 });
    await expect(withTenant(T, (tx) => renameRole(tx, owner, ownerRole, "Boss"))).rejects.toMatchObject({ status: 409 });
    await expect(withTenant(T, (tx) => removeRole(tx, owner, ownerRole))).rejects.toMatchObject({ status: 409 });
    await expect(withTenant(T, (tx) => addRole(tx, manager, { name: "Nope" }))).rejects.toMatchObject({ status: 403 });
  });
});

describe("invite links", () => {
  it("add staff → open the link → set a password → sign in; the link works once", async () => {
    const { staff, token } = await hire("coach", [role.Teacher ?? ""]);
    expect(await inviteInfo(token)).toEqual({ ok: true, staffName: "coach", email: `coach-${stamp}@example.test`, academy: `Roles ${stamp}` });
    await acceptInvite(token, PASSWORD);
    const session = await login({ slug, email: staff.email, password: PASSWORD });
    expect(session.context.actor.id).toBe(staff.id);
    expect(await inviteInfo(token)).toEqual({ ok: false, reason: "used" });
    await expect(acceptInvite(token, PASSWORD)).rejects.toThrow("expired or was already used");
  });

  it("a new link kills the old one; old links expire; a switched-off person can't use one", async () => {
    const { staff, token: first } = await hire("desk", [role["Front Desk"] ?? ""]);
    const second = await withTenant(T, (tx) => issueInvite(tx, owner, staff.id));
    expect(await inviteInfo(first)).toEqual({ ok: false, reason: "expired" });
    expect((await inviteInfo(second)).ok).toBe(true);

    const stale = await withTenant(T, (tx) => issueInvite(tx, owner, staff.id, new Date(Date.now() - 8 * 86_400_000)));
    await expect(acceptInvite(stale, PASSWORD)).rejects.toThrow("expired or was already used");

    const fresh = await withTenant(T, (tx) => issueInvite(tx, owner, staff.id));
    await withTenant(T, (tx) => deactivateStaff(tx, owner, staff.id));
    await expect(acceptInvite(fresh, PASSWORD)).rejects.toThrow("no longer valid");
    await expect(withTenant(T, (tx) => issueInvite(tx, owner, staff.id))).rejects.toThrow("Turn them back on first");
  });

  it("using a new link signs the person out everywhere; editing their role clears their cached access", async () => {
    const { staff, token } = await hire("reset", [role.Teacher ?? ""]);
    await acceptInvite(token, PASSWORD);
    const old = await login({ slug, email: staff.email, password: PASSWORD });
    expect(await getStaffSessionFromToken(old.token)).toBeDefined();

    await withTenant(T, (tx) => setRolePermissions(tx, owner, role.Teacher ?? "", ["students:read", "sessions:read", "attendance:mark", "attendance:read"]));
    expect((await getStaffSessionFromToken(old.token))?.permissions).toContain("attendance:read"); // rebuilt from the new ticks

    await withTenant(T, (tx) => reactivateStaff(tx, owner, staff.id));
    const again = await withTenant(T, (tx) => issueInvite(tx, owner, staff.id));
    await acceptInvite(again, "Another-Pass-7");
    expect(await getStaffSessionFromToken(old.token)).toBeUndefined();
  });
});

describe("the dashboard follows permissions", () => {
  it("each role gets exactly the blocks it may see", async () => {
    const teacher = await ctxFor((await hire("dash-teacher", [role.Teacher ?? ""])).staff.id);
    const desk = await ctxFor((await hire("dash-desk", [role["Front Desk"] ?? ""])).staff.id);
    const blocks = async (ctx: ScopedCtx) => Object.keys(await withTenant(T, (tx) => dashboardData(tx, ctx))).filter((k) => k !== "date").sort();
    expect(await blocks(owner)).toEqual(["atRisk", "money", "pipeline", "today"]);
    expect(await blocks(teacher)).toEqual(["atRisk", "today"]); // Teacher got attendance:read above
    expect(await blocks(desk)).toEqual(["atRisk", "money", "pipeline"]);
  });
});
