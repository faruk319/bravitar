import { z } from "zod";
import { type AccessContext, assertCan } from "@/lib/auth/can";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/cookie";
import { dummyPasswordHash, hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { buildSessionContext, type SessionContext } from "@/lib/auth/session";
import { hashToken, newSessionToken } from "@/lib/auth/token";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { TooManyRequestsError, UnauthorizedError } from "@/lib/errors";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { getStaff, updateStaffPassword } from "@/modules/staff/repo";
import { countRecentFailures, findActiveStaffByEmail, insertSession, recordLoginAttempt, revokeSession } from "./repo";

export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_MAX_FAILURES = 5;

export const loginSchema = z.object({
  slug: z.string().trim().min(1),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
  ip: z.string().optional(),
  userAgent: z.string().max(512).optional(),
});
export type LoginInput = z.input<typeof loginSchema>;

const BAD_CREDENTIALS = "Wrong email or password";

// One transaction to check and verify, a separate one to record the attempt,
// so a failed login still counts against the limit.
export async function login(input: LoginInput): Promise<{ token: string; sessionId: string; context: SessionContext }> {
  const data = loginSchema.parse(input);
  const tenant = await resolveTenantBySlug(data.slug);
  if (!tenant || tenant.status !== "active") throw new UnauthorizedError(BAD_CREDENTIALS);

  const failures = await withTenant(tenant.id, (tx) => countRecentFailures(tx, tenant.id, data.email, LOGIN_WINDOW_MINUTES));
  if (failures >= LOGIN_MAX_FAILURES) {
    throw new TooManyRequestsError(`Too many failed attempts. Try again in ${LOGIN_WINDOW_MINUTES} minutes.`);
  }

  const staff = await withTenant(tenant.id, (tx) => findActiveStaffByEmail(tx, data.email));
  const ok = await verifyPassword(staff?.passwordHash ?? (await dummyPasswordHash()), data.password);
  const attempt = { tenantId: tenant.id, email: data.email, succeeded: Boolean(staff && ok), ...(data.ip !== undefined ? { ip: data.ip } : {}) };
  await withTenant(tenant.id, (tx) => recordLoginAttempt(tx, attempt));
  if (!staff || !ok) throw new UnauthorizedError(BAD_CREDENTIALS);

  const token = newSessionToken();
  return withTenant(tenant.id, async (tx) => {
    const context = await buildSessionContext(tx, staff.id);
    const session = await insertSession(tx, {
      tokenHash: hashToken(token),
      actorType: "staff",
      actorId: staff.id,
      tenantId: tenant.id,
      cachedContext: context,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
      ...(data.ip !== undefined ? { ip: data.ip } : {}),
      ...(data.userAgent !== undefined ? { userAgent: data.userAgent } : {}),
    });
    await writeAudit(tx, { actorType: "staff", actorId: staff.id, tenantId: tenant.id, action: "auth.login", entityType: "session", entityId: session.id, ...(data.ip !== undefined ? { ip: data.ip } : {}) });
    return { token, sessionId: session.id, context };
  });
}

export async function logout(tenantId: string, sessionId: string, staffId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await revokeSession(tx, sessionId);
    await writeAudit(tx, { actorType: "staff", actorId: staffId, tenantId, action: "auth.logout", entityType: "session", entityId: sessionId });
  });
}

// Self-service, or staff:manage for someone else. Does not revoke sessions:
// that is the owner's explicit decision (deactivate).
export async function setPassword(tx: Tx, ctx: AccessContext, staffId: string, password: string): Promise<void> {
  if (staffId !== ctx.staffId) assertCan(ctx, "staff:manage");
  const staff = await getStaff(tx, staffId);
  if (!staff) throw new UnauthorizedError("Staff member not found");
  await updateStaffPassword(tx, staffId, await hashPassword(passwordSchema.parse(password)));
  await writeAudit(tx, { actorType: "staff", actorId: ctx.staffId, tenantId: ctx.tenantId, action: "staff.password.set", entityType: "staff_user", entityId: staffId });
}
