import { json, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { addBranch, ownerChangePlan, ownerRenameBranch, ownerSetCancel, startModule } from "./owner";

// The academy's own Billing changes (agreed 2026-09-30); /platform has its own routes.

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

// PATCH /api/billing/subscriptions/<id> { planId } | { cancelAtPeriodEnd }
export const ownerSubscriptionRoute = withStaffRequest("billing:manage", async (r) => {
  const id = pathSegment(r.req, 3);
  const body = await readJson<{ planId?: string; cancelAtPeriodEnd?: boolean }>(r.req);
  if (typeof body.cancelAtPeriodEnd === "boolean") {
    await ownerSetCancel(r.tx, ctxOf(r), id, body.cancelAtPeriodEnd);
    return json({ ok: true });
  }
  return json({ when: await ownerChangePlan(r.tx, ctxOf(r), id, body.planId ?? "") });
});

// POST /api/billing/branches { name, activityKey, planId }: a branch and its first module.
export const addBranchRoute = withStaffRequest("billing:manage", async (r) => json(await addBranch(r.tx, ctxOf(r), await readJson(r.req)), { status: 201 }));

// PATCH /api/billing/branches/<id> { name }
export const renameBranchRoute = withStaffRequest("settings:manage", async (r) => {
  await ownerRenameBranch(r.tx, ctxOf(r), pathSegment(r.req, 3), await readJson(r.req));
  return json({ ok: true });
});

// POST /api/billing/branches/<id>/modules { activityKey, planId }
export const startModuleRoute = withStaffRequest("billing:manage", async (r) => json(await startModule(r.tx, ctxOf(r), pathSegment(r.req, 3), await readJson(r.req)), { status: 201 }));
