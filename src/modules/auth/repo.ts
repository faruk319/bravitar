import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { staffRoles, type StaffUser, staffUsers } from "@/modules/staff/schema";
import { loginAttempts, loginHandoffs, type SessionRow, sessionsAuth } from "./schema";

type AnyTx = Tx | PlatformTx;

export async function findActiveStaffByEmail(tx: Tx, email: string): Promise<StaffUser | undefined> {
  const [row] = await tx
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.email, email), eq(staffUsers.isActive, true), isNull(staffUsers.deletedAt)));
  return row;
}

export type NewSession = {
  tokenHash: string;
  actorType: SessionRow["actorType"];
  actorId: string;
  tenantId: string;
  cachedContext: unknown;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
  impersonatedBy?: string;
  impersonationReason?: string;
};

export async function insertSession(tx: Tx, s: NewSession): Promise<SessionRow> {
  const [row] = await tx
    .insert(sessionsAuth)
    .values({ id: uuidv7(), ...s, ip: s.ip ?? null, userAgent: s.userAgent ?? null })
    .returning();
  if (!row) throw new Error("session insert returned no row");
  return row;
}

export async function revokeSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.update(sessionsAuth).set({ revokedAt: sql`now()` }).where(and(eq(sessionsAuth.id, sessionId), isNull(sessionsAuth.revokedAt)));
}

export async function revokeSessionsForStaff(tx: Tx, staffId: string): Promise<number> {
  const rows = await tx
    .update(sessionsAuth)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessionsAuth.actorType, "staff"), eq(sessionsAuth.actorId, staffId), isNull(sessionsAuth.revokedAt)))
    .returning({ id: sessionsAuth.id });
  return rows.length;
}

const live = and(isNull(sessionsAuth.revokedAt), gt(sessionsAuth.expiresAt, sql`now()`));

// Dropping the cache makes the next request rebuild it from the live tables.
export async function invalidateSessionsForStaff(tx: Tx, staffId: string): Promise<void> {
  await tx.update(sessionsAuth).set({ cachedContext: null }).where(and(eq(sessionsAuth.actorType, "staff"), eq(sessionsAuth.actorId, staffId), live));
}

export async function invalidateSessionsForRoleHolders(tx: Tx, roleId: string): Promise<void> {
  const holders = tx.select({ id: staffRoles.staffId }).from(staffRoles).where(eq(staffRoles.roleId, roleId));
  await tx.update(sessionsAuth).set({ cachedContext: null }).where(and(eq(sessionsAuth.actorType, "staff"), inArray(sessionsAuth.actorId, holders), live));
}

export async function invalidateSessionsForTenant(tx: AnyTx, tenantId: string): Promise<void> {
  await tx.update(sessionsAuth).set({ cachedContext: null }).where(and(eq(sessionsAuth.tenantId, tenantId), live));
}

export async function setCachedContext(tx: Tx, sessionId: string, context: unknown): Promise<void> {
  await tx.update(sessionsAuth).set({ cachedContext: context }).where(eq(sessionsAuth.id, sessionId));
}

export async function recordLoginAttempt(tx: Tx, a: { tenantId: string; email: string; ip?: string; succeeded: boolean }): Promise<void> {
  await tx.insert(loginAttempts).values({ id: uuidv7(), tenantId: a.tenantId, email: a.email, ip: a.ip ?? null, succeeded: a.succeeded });
}

export async function countRecentFailures(tx: Tx, tenantId: string, email: string, windowMinutes: number): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.tenantId, tenantId),
        eq(loginAttempts.email, email),
        eq(loginAttempts.succeeded, false),
        gt(loginAttempts.attemptedAt, sql`now() - make_interval(mins => ${windowMinutes})`),
      ),
    );
  return row?.n ?? 0;
}

// ---- one login page (migration 0019)

export type StaffAcademy = { tenantId: string; slug: string; name: string };

// Before any academy is known: where an active staff account has this email.
export async function staffAcademiesByEmail(email: string): Promise<StaffAcademy[]> {
  const rows = await db.execute<{ tenant_id: string; slug: string; name: string }>(sql`SELECT * FROM app.staff_academies_by_email(${email})`);
  return rows.map((r) => ({ tenantId: r.tenant_id, slug: r.slug, name: r.name }));
}

// Before any academy is known: where this phone is a guardian who may sign in.
export async function guardianAcademiesByPhone(phone: string): Promise<StaffAcademy[]> {
  const rows = await db.execute<{ tenant_id: string; slug: string; name: string }>(sql`SELECT * FROM app.guardian_academies_by_phone(${phone})`);
  return rows.map((r) => ({ tenantId: r.tenant_id, slug: r.slug, name: r.name }));
}

export type HandoffFor = { staffId: string; impersonatedBy?: string; impersonationReason?: string } | { guardianId: string };

export async function insertHandoff(tx: Tx | PlatformTx, row: HandoffFor & { tenantId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
  await tx.insert(loginHandoffs).values({ id: uuidv7(), ...row });
}

// Uses up a live pass in one statement; returns whose it was.
export async function useHandoff(tx: Tx, tokenHash: string, now: Date): Promise<HandoffFor | undefined> {
  const [row] = await tx
    .update(loginHandoffs)
    .set({ usedAt: now })
    .where(and(eq(loginHandoffs.tokenHash, tokenHash), isNull(loginHandoffs.usedAt), gt(loginHandoffs.expiresAt, now)))
    .returning({ staffId: loginHandoffs.staffId, guardianId: loginHandoffs.guardianId, impersonatedBy: loginHandoffs.impersonatedBy, impersonationReason: loginHandoffs.impersonationReason });
  if (row?.staffId) return { staffId: row.staffId, ...(row.impersonatedBy ? { impersonatedBy: row.impersonatedBy, impersonationReason: row.impersonationReason ?? "" } : {}) };
  return row?.guardianId ? { guardianId: row.guardianId } : undefined;
}
