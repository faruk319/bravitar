import { branchCookieHeader } from "@/lib/auth/branch-cookie";
import { json, withStaffRequest } from "@/lib/auth/route";
import { NotFoundError } from "@/lib/errors";
import { getBranch } from "@/modules/tenancy/repo";

// Remembers the chosen branch for this browser. RLS keeps the lookup inside
// the tenant; staff scoped to branches may only pick one of theirs.
export const POST = withStaffRequest(null, async ({ req, session, tx }) => {
  const body = (await req.json().catch(() => ({}))) as { branchId?: unknown };
  const branchId = typeof body.branchId === "string" ? body.branchId : "all";
  if (branchId !== "all") {
    if (!(await getBranch(tx, branchId))) throw new NotFoundError("Branch");
    if (session.branchIds.length && !session.branchIds.includes(branchId)) throw new NotFoundError("Branch");
  }
  return json({ branchId }, { headers: { "set-cookie": branchCookieHeader(branchId) } });
});
