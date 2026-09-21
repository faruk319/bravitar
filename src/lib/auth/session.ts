import { sql } from "drizzle-orm";
import { readSessionCookie } from "@/lib/auth/cookie";
import { hashToken } from "@/lib/auth/token";
import { db, type Tx } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { setCachedContext } from "@/modules/auth/repo";
import { getStaff, staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { getOwnTenant } from "@/modules/tenancy/repo";

// docs/01 "Session payload assembled on login". Cached on the session row and
// rebuilt whenever roles, permissions, modules or branches change.
export type SessionContext = {
  actor: { type: "staff"; id: string; name: string };
  tenant: { id: string; slug: string; timezone: string };
  branchIds: string[];
  isOwner: boolean;
  modules: Record<string, boolean>;
  permissions: string[];
};

export type StaffSession = SessionContext & { sessionId: string };

export async function buildSessionContext(tx: Tx, staffId: string): Promise<SessionContext> {
  const access = await loadAccessContext(tx, staffId);
  const staff = await getStaff(tx, staffId);
  const tenant = await getOwnTenant(tx);
  const branchIds = await staffBranchIds(tx, staffId);
  if (!staff || !tenant) throw new Error("session context: staff or tenant missing");
  return {
    actor: { type: "staff", id: staff.id, name: staff.fullName },
    tenant: { id: tenant.id, slug: tenant.slug, timezone: tenant.timezone },
    branchIds,
    isOwner: access.isOwner,
    modules: access.modules,
    permissions: access.permissions,
  };
}

type LookupRow = {
  id: string;
  actor_type: string;
  actor_id: string;
  tenant_id: string | null;
  cached_context: SessionContext | null;
  expires_at: Date;
  revoked_at: Date | null;
};

// Cookie -> live session, or undefined. The only query that runs without a
// tenant context is the SECURITY DEFINER lookup by token hash.
export async function getStaffSession(req: Request): Promise<StaffSession | undefined> {
  const token = readSessionCookie(req);
  if (!token) return undefined;
  const [row] = await db.execute<LookupRow>(sql`SELECT * FROM app.session_by_token_hash(${hashToken(token)})`);
  if (!row || row.actor_type !== "staff" || !row.tenant_id) return undefined;
  if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  if (row.cached_context) return { sessionId: row.id, ...row.cached_context };

  // Cache was invalidated: rebuild inside the tenant, re-checking the staff row.
  const tenantId = row.tenant_id;
  return withTenant(tenantId, async (tx) => {
    const context = await buildSessionContext(tx, row.actor_id).catch(() => undefined);
    if (!context) return undefined;
    await setCachedContext(tx, row.id, context);
    return { sessionId: row.id, ...context };
  });
}
