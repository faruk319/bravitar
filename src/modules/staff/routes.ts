import { json, jsonError, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { BadRequestError } from "@/lib/errors";
import { acceptInvite, addRole, addStaff, deactivateStaff, issueInvite, reactivateStaff, removeRole, renameRole, setRolePermissions, setStaffBranches, setStaffRole } from "./service";

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

export const addStaffRoute = withStaffRequest("staff:manage", async (r) => {
  const { staff, token } = await addStaff(r.tx, ctxOf(r), await readJson<Parameters<typeof addStaff>[2]>(r.req));
  return json({ id: staff.id, token }, { status: 201 });
});

export const staffActionRoute = withStaffRequest("staff:manage", async (r) => {
  const id = pathSegment(r.req, 2);
  const body = await readJson<{ action?: string; roleId?: string; branchIds?: string[] }>(r.req);
  const ctx = ctxOf(r);
  if (body.action === "invite") return json({ token: await issueInvite(r.tx, ctx, id) });
  if (body.action === "deactivate") return json(await deactivateStaff(r.tx, ctx, id));
  if (body.action === "reactivate") return json(await reactivateStaff(r.tx, ctx, id));
  if (body.action === "access") {
    await setStaffRole(r.tx, ctx, id, body.roleId ?? "");
    await setStaffBranches(r.tx, ctx, id, body.branchIds ?? []);
    return json({ ok: true });
  }
  throw new BadRequestError("Unknown action");
});

export const addRoleRoute = withStaffRequest("staff:manage", async (r) => json(await addRole(r.tx, ctxOf(r), await readJson<Parameters<typeof addRole>[2]>(r.req)), { status: 201 }));

export const editRoleRoute = withStaffRequest("staff:manage", async (r) => {
  const id = pathSegment(r.req, 2);
  const body = await readJson<{ name?: string; keys?: string[] }>(r.req);
  if (body.name !== undefined) await renameRole(r.tx, ctxOf(r), id, body.name);
  if (body.keys) await setRolePermissions(r.tx, ctxOf(r), id, body.keys);
  return json({ ok: true });
});

export const deleteRoleRoute = withStaffRequest("staff:manage", async (r) => {
  await removeRole(r.tx, ctxOf(r), pathSegment(r.req, 2));
  return json({ ok: true });
});

// Public: the person setting a password has no session yet; the token is the proof.
export async function acceptInviteRoute(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ token?: unknown; password?: unknown }>(req);
    await acceptInvite(String(body.token ?? ""), String(body.password ?? ""));
    return json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
