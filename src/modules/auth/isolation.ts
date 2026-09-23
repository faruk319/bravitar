import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { hashToken, newToken } from "@/lib/auth/token";
import { uuidv7 } from "@/lib/ids";
import { loginAttempts, sessionsAuth } from "./schema";

export const authFixtures: IsolationFixtures = {
  sessions_auth: (tx, tenantId) =>
    tx.insert(sessionsAuth).values({
      id: uuidv7(),
      tokenHash: hashToken(newToken()),
      actorType: "staff",
      actorId: uuidv7(),
      tenantId,
      expiresAt: new Date(Date.now() + 60_000),
    }),
  login_attempts: (tx, tenantId) => tx.insert(loginAttempts).values({ id: uuidv7(), tenantId, email: "iso@example.test", succeeded: false }),
};
