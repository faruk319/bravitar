import { and, eq, sql } from "drizzle-orm";
import { readSessionCookie } from "@/lib/auth/cookie";
import { hashToken } from "@/lib/auth/token";
import { db, type Tx } from "@/lib/db/client";
import { platformRead } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { platformAdmins } from "@/modules/platform/schema";
import { setCachedContext } from "@/modules/auth/repo";
import { getStaff, staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { getGuardian } from "@/modules/students/repo";
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

// Bravitar support signed in as this staff member (Prompt 21): who and why.
export type Impersonation = { by: string; reason: string };
export type StaffSession = SessionContext & { sessionId: string; impersonation?: Impersonation };

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

// A parent or adult student (Prompt 20). The phone their code proved is kept
// for switching academies without a new code.
export type GuardianContext = { actor: { type: "guardian"; id: string; name: string }; tenant: { id: string; slug: string; name: string; timezone: string }; phone: string };
export type GuardianSession = GuardianContext & { sessionId: string };

type LookupRow = {
  id: string;
  actor_type: string;
  actor_id: string;
  tenant_id: string | null;
  impersonated_by: string | null;
  impersonation_reason: string | null;
  cached_context: unknown;
  expires_at: Date;
  revoked_at: Date | null;
};

async function liveRow(token: string, actorType: "staff" | "guardian" | "platform"): Promise<LookupRow | undefined> {
  const [row] = await db.execute<LookupRow>(sql`SELECT * FROM app.session_by_token_hash(${hashToken(token)})`);
  if (!row || row.actor_type !== actorType || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return row;
}

async function liveSession(token: string, actorType: "staff" | "guardian"): Promise<(LookupRow & { tenant_id: string }) | undefined> {
  const row = await liveRow(token, actorType);
  return row?.tenant_id ? { ...row, tenant_id: row.tenant_id } : undefined;
}

// Cookie -> live session, or undefined.
export async function getStaffSession(req: Request): Promise<StaffSession | undefined> {
  const token = readSessionCookie(req);
  return token ? getStaffSessionFromToken(token) : undefined;
}

// Token -> live session, or undefined. The only query that runs without a
// tenant context is the SECURITY DEFINER lookup by token hash.
export async function getStaffSessionFromToken(token: string): Promise<StaffSession | undefined> {
  const row = await liveSession(token, "staff");
  if (!row) return undefined;
  const impersonation = row.impersonated_by ? { impersonation: { by: row.impersonated_by, reason: row.impersonation_reason ?? "" } } : {};
  if (row.cached_context) return { sessionId: row.id, ...(row.cached_context as SessionContext), ...impersonation };

  // Cache was invalidated: rebuild inside the tenant, re-checking the staff row.
  const tenantId = row.tenant_id;
  return withTenant(tenantId, async (tx) => {
    const context = await buildSessionContext(tx, row.actor_id).catch(() => undefined);
    if (!context) return undefined;
    await setCachedContext(tx, row.id, context);
    return { sessionId: row.id, ...context, ...impersonation };
  });
}

// Token -> a guardian's live session. The guardian is re-read every time, so
// one removed or with login turned off is signed out at once.
export async function getGuardianSessionFromToken(token: string): Promise<GuardianSession | undefined> {
  const row = await liveSession(token, "guardian");
  if (!row?.cached_context) return undefined;
  const context = row.cached_context as GuardianContext;
  const guardian = await withTenant(row.tenant_id, (tx) => getGuardian(tx, row.actor_id));
  return guardian?.canLogin ? { sessionId: row.id, ...context, actor: { ...context.actor, name: guardian.fullName } } : undefined;
}

// You, in /platform (Prompt 21): no academy. The admin is re-read every time.
export type PlatformSession = { sessionId: string; actor: { type: "platform"; id: string; name: string } };

export async function getPlatformSessionFromToken(token: string): Promise<PlatformSession | undefined> {
  const row = await liveRow(token, "platform");
  if (!row || row.tenant_id) return undefined;
  const [admin] = await platformRead((tx) => tx.select({ id: platformAdmins.id, name: platformAdmins.fullName }).from(platformAdmins).where(and(eq(platformAdmins.id, row.actor_id), eq(platformAdmins.isActive, true))));
  return admin ? { sessionId: row.id, actor: { type: "platform", id: admin.id, name: admin.name } } : undefined;
}
