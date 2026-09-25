import { json, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { createEnquiry, editEnquiry, logActivity, markLost, phoneMatches, reopenEnquiry } from "./service";

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);
const idOf = (r: StaffRequest) => pathSegment(r.req, 2);

export const createRoute = withStaffRequest("enquiries:create", async (r) => json(await createEnquiry(r.tx, ctxOf(r), await readJson(r.req)), { status: 201 }));

// GET /api/enquiries/check?phone=: open enquiries and a family on this phone.
export const checkRoute = withStaffRequest("enquiries:read", async (r) => {
  const q = new URL(r.req.url).searchParams;
  return json(await phoneMatches(r.tx, ctxOf(r), q.get("phone") ?? "", q.get("except") ?? undefined));
});

export const editRoute = withStaffRequest("enquiries:update", async (r) => json(await editEnquiry(r.tx, ctxOf(r), idOf(r), await readJson(r.req))));

export const activityRoute = withStaffRequest("enquiries:update", async (r) => json(await logActivity(r.tx, ctxOf(r), idOf(r), await readJson(r.req))));

export const lostRoute = withStaffRequest("enquiries:update", async (r) => json(await markLost(r.tx, ctxOf(r), idOf(r), await readJson(r.req))));

export const reopenRoute = withStaffRequest("enquiries:update", async (r) => json(await reopenEnquiry(r.tx, ctxOf(r), idOf(r))));
