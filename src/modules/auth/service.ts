import { z } from "zod";
import { type AccessContext, assertCan } from "@/lib/auth/can";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/cookie";
import { dummyPasswordHash, hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { buildSessionContext, type GuardianContext, type SessionContext } from "@/lib/auth/session";
import { hashToken, newToken } from "@/lib/auth/token";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { TooManyRequestsError, UnauthorizedError } from "@/lib/errors";
import { phoneSchema } from "@/lib/phone";
import { tenantOrigin } from "@/lib/tenant/origin";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { getStaff, updateStaffPassword, updateStaffPhone } from "@/modules/staff/repo";
import { getGuardian } from "@/modules/students/repo";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { countRecentFailures, findActiveStaffByEmail, type HandoffFor, insertHandoff, insertSession, recordLoginAttempt, revokeSession, type StaffAcademy, staffAcademiesByEmail, useHandoff } from "./repo";

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

export type Meta = { ip?: string | undefined; userAgent?: string | undefined };
export type OpenedSession = { token: string; sessionId: string; context: SessionContext };

// A new 30-day session for a staff member, audited as a login.
export async function openSession(tx: Tx, tenantId: string, staffId: string, meta: Meta, via?: string): Promise<OpenedSession> {
  const token = newToken();
  const context = await buildSessionContext(tx, staffId);
  const session = await insertSession(tx, {
    tokenHash: hashToken(token),
    actorType: "staff",
    actorId: staffId,
    tenantId,
    cachedContext: context,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
    ...(meta.userAgent !== undefined ? { userAgent: meta.userAgent } : {}),
  });
  await writeAudit(tx, { actorType: "staff", actorId: staffId, tenantId, action: "auth.login", entityType: "session", entityId: session.id, ...(meta.ip !== undefined ? { ip: meta.ip } : {}), ...(via ? { after: { via } } : {}) });
  return { token, sessionId: session.id, context };
}

// A new 30-day session for a parent or adult student, in this academy's
// context, keeping the phone their code proved.
export async function openGuardianSession(tx: Tx, guardianId: string, phone: string, meta: Meta, via?: string): Promise<{ token: string; sessionId: string }> {
  const [guardian, tenant] = [await getGuardian(tx, guardianId), await getOwnTenant(tx)];
  if (!guardian?.canLogin || !tenant) throw new UnauthorizedError("This number can't sign in here");
  const token = newToken();
  const context: GuardianContext = { actor: { type: "guardian", id: guardian.id, name: guardian.fullName }, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone }, phone };
  const session = await insertSession(tx, {
    tokenHash: hashToken(token),
    actorType: "guardian",
    actorId: guardian.id,
    tenantId: tenant.id,
    cachedContext: context,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
    ...(meta.userAgent !== undefined ? { userAgent: meta.userAgent } : {}),
  });
  await writeAudit(tx, { actorType: "guardian", actorId: guardian.id, tenantId: tenant.id, action: "auth.login", entityType: "session", entityId: session.id, ...(meta.ip !== undefined ? { ip: meta.ip } : {}), ...(via ? { after: { via } } : {}) });
  return { token, sessionId: session.id };
}

// One transaction to check and verify, a separate one to record the attempt,
// so a failed login still counts against the limit.
export async function login(input: LoginInput): Promise<OpenedSession> {
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
  return withTenant(tenant.id, (tx) => openSession(tx, tenant.id, staff.id, data));
}

// ---- one login page on the main site (agreed 2026-09-25)

export const HANDOFF_SECONDS = 120;
export const signInSchema = loginSchema.omit({ slug: true });
export type Academy = { name: string; url: string };

// A one-time pass to the academy's own address, where the session is opened.
export async function handoffTo(academy: StaffAcademy, who: HandoffFor, now: Date): Promise<Academy> {
  const token = newToken();
  await withTenant(academy.tenantId, (tx) => insertHandoff(tx, { ...who, tenantId: academy.tenantId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + HANDOFF_SECONDS * 1000) }));
  return { name: academy.name, url: `${tenantOrigin(academy.slug)}/api/auth/handoff?t=${token}` };
}

// The password is checked in each academy with this email, under that
// academy's own failure limit; the academies are named only after it matches.
// Each match gets a one-time pass to its own address. Every failure reads the
// same, so the page never shows whether an email exists.
export async function signIn(input: z.input<typeof signInSchema>, opts: { now?: Date } = {}): Promise<Academy[]> {
  const data = signInSchema.parse(input);
  const now = opts.now ?? new Date();
  const found: Academy[] = [];
  const candidates = await staffAcademiesByEmail(data.email);
  if (!candidates.length) await verifyPassword(await dummyPasswordHash(), data.password);
  for (const t of candidates) {
    const failures = await withTenant(t.tenantId, (tx) => countRecentFailures(tx, t.tenantId, data.email, LOGIN_WINDOW_MINUTES));
    if (failures >= LOGIN_MAX_FAILURES) continue;
    const staff = await withTenant(t.tenantId, (tx) => findActiveStaffByEmail(tx, data.email));
    const ok = Boolean(staff) && (await verifyPassword(staff?.passwordHash ?? "", data.password));
    await withTenant(t.tenantId, (tx) => recordLoginAttempt(tx, { tenantId: t.tenantId, email: data.email, succeeded: ok, ...(data.ip !== undefined ? { ip: data.ip } : {}) }));
    if (staff && ok) found.push(await handoffTo(t, { staffId: staff.id }, now));
  }
  if (!found.length) throw new UnauthorizedError(`${BAD_CREDENTIALS}. After ${LOGIN_MAX_FAILURES} wrong tries, wait ${LOGIN_WINDOW_MINUTES} minutes.`);
  return found;
}

// On the academy's own address: a live pass for this academy opens a session,
// a staff member's or a guardian's, and says where to go next.
export async function redeemHandoff(slug: string | undefined, token: string, meta: Meta, opts: { now?: Date } = {}): Promise<{ token: string; home: string } | undefined> {
  const tenant = slug ? await resolveTenantBySlug(slug) : undefined;
  if (!tenant || tenant.status !== "active" || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
  return withTenant(tenant.id, async (tx) => {
    const who = await useHandoff(tx, hashToken(token), opts.now ?? new Date());
    if (who && "staffId" in who) {
      const staff = await getStaff(tx, who.staffId);
      return staff?.isActive ? { token: (await openSession(tx, tenant.id, staff.id, meta, "main site")).token, home: "/" } : undefined;
    }
    const guardian = who ? await getGuardian(tx, who.guardianId) : undefined;
    return guardian?.canLogin ? { token: (await openGuardianSession(tx, guardian.id, guardian.phone, meta, "main site")).token, home: "/portal" } : undefined;
  });
}

export async function logout(tenantId: string, sessionId: string, actor: { actorType: "staff" | "guardian"; actorId: string }): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await revokeSession(tx, sessionId);
    await writeAudit(tx, { ...actor, tenantId, action: "auth.logout", entityType: "session", entityId: sessionId });
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

// ---- the phone reset codes go to (agreed 2026-09-25)

export const phoneChangeSchema = z.object({ phone: phoneSchema, password: z.string().min(1).max(128) });

// One's own, behind the password, so a session left open can't take the
// account over. A wrong password counts towards the login limit; it returns
// undefined rather than throwing, so that count is kept.
export async function setOwnPhone(tx: Tx, ctx: AccessContext, input: z.input<typeof phoneChangeSchema>): Promise<string | undefined> {
  const data = phoneChangeSchema.parse(input);
  const staff = await getStaff(tx, ctx.staffId);
  if (!staff) throw new UnauthorizedError();
  if ((await countRecentFailures(tx, ctx.tenantId, staff.email, LOGIN_WINDOW_MINUTES)) >= LOGIN_MAX_FAILURES) {
    throw new TooManyRequestsError(`Too many wrong passwords. Try again in ${LOGIN_WINDOW_MINUTES} minutes.`);
  }
  const ok = await verifyPassword(staff.passwordHash, data.password);
  await recordLoginAttempt(tx, { tenantId: ctx.tenantId, email: staff.email, succeeded: ok });
  if (!ok) return undefined;
  await updateStaffPhone(tx, staff.id, data.phone);
  await writeAudit(tx, { actorType: "staff", actorId: staff.id, tenantId: ctx.tenantId, action: "staff.phone.update", entityType: "staff_user", entityId: staff.id, after: { phone: data.phone } });
  return data.phone;
}
