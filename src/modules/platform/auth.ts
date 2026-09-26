import { and, count, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { dummyPasswordHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { hashToken, newToken } from "@/lib/auth/token";
import { newTotpSecret, totpMatch } from "@/lib/auth/totp";
import { open, seal } from "@/lib/crypto";
import { platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { TooManyRequestsError, UnauthorizedError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { sessionsAuth } from "@/modules/auth/schema";
import { platformAdmins, platformLoginAttempts } from "./schema";

// You sign in to /platform with email, password and an authenticator code
// (agreed 2026-09-26). Every failure reads the same; 5 in 15 minutes waits.

export const PLATFORM_SESSION_HOURS = 12;
const WINDOW_MINUTES = 15;
const MAX_FAILURES = 5;
const WRONG = "Wrong email, password or code";
const owner = (adminId: string) => `platform_admin:${adminId}`;

export const newAdminSchema = z.object({ email: z.email().trim().toLowerCase(), fullName: z.string().trim().min(2).max(120), password: z.string().min(12).max(128) });

// Returns the authenticator setup key, shown once.
export async function createPlatformAdmin(input: z.input<typeof newAdminSchema>, opts: { secret?: string } = {}): Promise<{ id: string; secret: string }> {
  const data = newAdminSchema.parse(input);
  const id = uuidv7();
  const secret = opts.secret ?? newTotpSecret();
  const passwordHash = await hashPassword(data.password);
  await withPlatformAdmin({ actorType: "system", action: "platform_admin.create", entityType: "platform_admin", entityId: id, after: { email: data.email } }, (tx) =>
    tx.insert(platformAdmins).values({ id, email: data.email, fullName: data.fullName, passwordHash, totpSecret: seal(secret, owner(id)) }),
  );
  return { id, secret };
}

export const platformSignInSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
  code: z.string().trim().max(12),
  ip: z.string().optional(),
  userAgent: z.string().max(512).optional(),
});

// A 12-hour session with no academy. A code works once: its time step must be
// later than the last one used.
export async function platformSignIn(input: z.input<typeof platformSignInSchema>, opts: { now?: Date } = {}): Promise<{ token: string }> {
  const data = platformSignInSchema.parse(input);
  const now = opts.now ?? new Date();
  const ip = data.ip ? { ip: data.ip } : {};
  const [failed] = await platformRead((tx) =>
    tx
      .select({ n: count() })
      .from(platformLoginAttempts)
      .where(and(eq(platformLoginAttempts.email, data.email), eq(platformLoginAttempts.succeeded, false), gte(platformLoginAttempts.attemptedAt, new Date(now.getTime() - WINDOW_MINUTES * 60_000)))),
  );
  if ((failed?.n ?? 0) >= MAX_FAILURES) throw new TooManyRequestsError(`Too many failed attempts. Try again in ${WINDOW_MINUTES} minutes.`);

  const [admin] = await platformRead((tx) => tx.select().from(platformAdmins).where(and(eq(platformAdmins.email, data.email), eq(platformAdmins.isActive, true))));
  const passwordOk = await verifyPassword(admin?.passwordHash ?? (await dummyPasswordHash()), data.password);
  const step = admin && passwordOk ? totpMatch(open(admin.totpSecret, owner(admin.id)), data.code, now) : undefined;

  const signedIn =
    admin && step !== undefined && step > admin.totpLastStep
      ? await withPlatformAdmin({ actorType: "platform", actorId: admin.id, action: "platform.login", entityType: "session", ...ip }, async (tx, audit) => {
          // Taken under the row's own check, so the same code can't open two sessions.
          const used = await tx.update(platformAdmins).set({ totpLastStep: step }).where(and(eq(platformAdmins.id, admin.id), lt(platformAdmins.totpLastStep, step))).returning({ id: platformAdmins.id });
          if (!used.length) throw new UnauthorizedError(WRONG);
          const token = newToken();
          const id = uuidv7();
          const context = { actor: { type: "platform", id: admin.id, name: admin.fullName } };
          await tx.insert(sessionsAuth).values({ id, tokenHash: hashToken(token), actorType: "platform", actorId: admin.id, tenantId: null, cachedContext: context, expiresAt: new Date(now.getTime() + PLATFORM_SESSION_HOURS * 3_600_000), ip: data.ip ?? null, userAgent: data.userAgent ?? null });
          await tx.insert(platformLoginAttempts).values({ email: data.email, ip: data.ip ?? null, succeeded: true, attemptedAt: now });
          audit.entityId = id;
          return token;
        })
      : undefined;
  if (signedIn) return { token: signedIn };
  await withPlatformAdmin({ actorType: "system", action: "platform.login.failed", entityType: "platform_admin", after: { email: data.email }, ...ip }, (tx) =>
    tx.insert(platformLoginAttempts).values({ email: data.email, ip: data.ip ?? null, succeeded: false, attemptedAt: now }),
  );
  throw new UnauthorizedError(WRONG);
}

export async function platformLogout(sessionId: string, adminId: string): Promise<void> {
  await withPlatformAdmin({ actorType: "platform", actorId: adminId, action: "auth.logout", entityType: "session", entityId: sessionId }, (tx) =>
    tx.update(sessionsAuth).set({ revokedAt: new Date() }).where(eq(sessionsAuth.id, sessionId)),
  );
}
