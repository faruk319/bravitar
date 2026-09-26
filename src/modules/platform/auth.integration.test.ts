import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformSessionFromToken, getStaffSessionFromToken } from "@/lib/auth/session";
import { newTotpSecret, totp } from "@/lib/auth/totp";
import { sql as runtimeSql } from "@/lib/db/client";
import { platformDb, platformSql } from "@/lib/db/platform";
import { sessionsAuth } from "@/modules/auth/schema";
import { createPlatformAdmin, platformSignIn } from "./auth";
import { platformAdmins, platformLoginAttempts } from "./schema";

// Prompt 21: you sign in to /platform with email, password and an
// authenticator code (agreed 2026-09-26). A code works once; 5 wrong tries in
// 15 minutes wait; every failure reads the same.

const stamp = Math.random().toString(36).slice(2, 8);
const EMAIL = `admin-${stamp}@example.test`;
const PASSWORD = "Platform-Horse-42";
const SECRET = newTotpSecret();
const T0 = new Date("2031-05-05T05:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
let adminId = "";
const emails = [EMAIL, `locked-${stamp}@example.test`];

beforeAll(async () => {
  adminId = (await createPlatformAdmin({ email: EMAIL, fullName: "Faruk Admin", password: PASSWORD }, { secret: SECRET })).id;
});

afterAll(async () => {
  await platformDb.delete(sessionsAuth).where(eq(sessionsAuth.actorId, adminId));
  await platformDb.delete(platformLoginAttempts).where(inArray(platformLoginAttempts.email, emails));
  await platformDb.delete(platformAdmins).where(eq(platformAdmins.id, adminId));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("signing in to /platform", () => {
  it("email, password and the authenticator code open a session with no academy; the same code never twice", async () => {
    const code = totp(SECRET, at(0));
    const { token } = await platformSignIn({ email: EMAIL, password: PASSWORD, code }, { now: at(0) });
    expect(await getPlatformSessionFromToken(token)).toMatchObject({ actor: { type: "platform", id: adminId, name: "Faruk Admin" } });
    expect(await getStaffSessionFromToken(token)).toBeUndefined();
    await expect(platformSignIn({ email: EMAIL, password: PASSWORD, code }, { now: at(5) })).rejects.toThrow("Wrong email, password or code");
    const next = await platformSignIn({ email: EMAIL, password: PASSWORD, code: totp(SECRET, at(40)) }, { now: at(40) });
    expect(next.token).not.toBe(token);
  });

  it("a wrong password, a wrong code and an unknown email read the same", async () => {
    const messages = await Promise.all([
      platformSignIn({ email: EMAIL, password: "Nope-Nope-Nope", code: totp(SECRET, at(100)) }, { now: at(100) }).catch((e: Error) => e.message),
      platformSignIn({ email: EMAIL, password: PASSWORD, code: "000000" }, { now: at(100) }).catch((e: Error) => e.message),
      platformSignIn({ email: `nobody-${stamp}@example.test`, password: PASSWORD, code: "000000" }, { now: at(100) }).catch((e: Error) => e.message),
    ]);
    expect(new Set(messages)).toEqual(new Set(["Wrong email, password or code"]));
  });

  it("after 5 wrong tries in 15 minutes, even the right ones wait", async () => {
    const email = emails[1] ?? "";
    for (let i = 0; i < 5; i++) await platformSignIn({ email, password: "Nope-Nope-Nope", code: "000000" }, { now: at(200 + i) }).catch(() => undefined);
    await expect(platformSignIn({ email, password: PASSWORD, code: "000000" }, { now: at(210) })).rejects.toMatchObject({ status: 429 });
  });
});
