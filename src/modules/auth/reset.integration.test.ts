import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStaffSessionFromToken } from "@/lib/auth/session";
import { auditLog } from "@/lib/db/audit";
import { db, sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { listRoles } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { testAcademy } from "@/lib/db/isolation/academy";
import type { CodeSender } from "./codes";
import { requestReset, resetPassword } from "./reset";
import { login, setOwnPhone, setPassword } from "./service";

// Forgot password by a WhatsApp code (agreed 2026-09-25), with the docs/01
// limits kept by the database: 5 minutes, single use, 3 per phone per
// 15 minutes, 5 wrong tries lock the phone for an hour.

const stamp = Math.random().toString(36).slice(2, 8);
const digits = () => String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
const P = `+9197${digits()}`; // on the accounts in A and B
const Q = `+9196${digits()}`; // on the account in C
const EMAIL = `desk-${stamp}@example.test`;
const NO_PHONE = `nophone-${stamp}@example.test`;
const [OLD, NEW, NEWER] = ["Old-Horse-1", "New-Horse-2", "Newer-Horse-3"];
const made = {} as Record<"a" | "b" | "c", { id: string; slug: string; name: string; staffId: string }>;
const got: { phone: string; code: string }[] = [];
const send: CodeSender = async (phone, code) => {
  got.push({ phone, code });
};
const T0 = new Date("2031-03-03T05:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const codesTo = (phone: string) => got.filter((g) => g.phone === phone);
const lastCode = (phone: string) => codesTo(phone).at(-1)?.code ?? "";

beforeAll(async () => {
  for (const [key, phone] of [["a", P], ["b", P], ["c", Q]] as const) {
    const slug = `reset-${key}-${stamp}`;
    const t = await testAcademy({ name: `Reset ${key.toUpperCase()} ${stamp}`, slug, owner: { name: "Owner", email: `owner-${key}-${stamp}@example.test` } });
    const staffId = await withTenant(t.tenant.id, async (tx) => {
      const ctx = await loadAccessContext(tx, t.owner.id);
      const roleId = (await listRoles(tx)).find((r) => r.name === "Teacher")?.id ?? "";
      const s = await createStaffMember(tx, ctx, { email: EMAIL, fullName: "Neha Desk", phone, roleId });
      await setPassword(tx, ctx, s.id, OLD);
      if (key === "a") await setPassword(tx, ctx, (await createStaffMember(tx, ctx, { email: NO_PHONE, fullName: "No Phone", roleId })).id, OLD);
      return s.id;
    });
    made[key] = { id: t.tenant.id, slug, name: t.tenant.name, staffId };
  }
});

afterAll(async () => {
  await deleteTenantsCompletely(Object.values(made).map((m) => m.id));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("asking for a code", () => {
  it("goes once to each phone on accounts with this email; nothing for no phone or an unknown email, with the same answer", async () => {
    await requestReset({ email: EMAIL }, { send, now: at(0) });
    expect(got.map((g) => g.phone).sort()).toEqual([P, Q].sort());
    expect(lastCode(P)).toMatch(/^\d{6}$/);
    await expect(requestReset({ email: NO_PHONE }, { send, now: at(0) })).resolves.toBeUndefined();
    await expect(requestReset({ email: `nobody-${stamp}@example.test` }, { send, now: at(0) })).resolves.toBeUndefined();
    expect(got).toHaveLength(2);
  });

  it("at most 3 to a phone in 15 minutes", async () => {
    for (const m of [1, 2, 3]) await requestReset({ email: EMAIL }, { slug: made.a.slug, send, now: at(m) });
    expect(codesTo(P)).toHaveLength(3);
    await requestReset({ email: EMAIL }, { slug: made.a.slug, send, now: at(16) });
    expect(codesTo(P)).toHaveLength(4);
  });
});

describe("setting a new password with the code", () => {
  it("resets every account with this email and phone, ends their sessions, audits it, and hands over to each academy", async () => {
    const before = await login({ slug: made.a.slug, email: EMAIL, password: OLD });
    const done = await resetPassword({ email: EMAIL, code: lastCode(P), password: NEW }, { now: at(17) });
    expect("academies" in done && done.academies.map((a) => a.name)).toEqual([made.a.name, made.b.name]);

    await expect(login({ slug: made.a.slug, email: EMAIL, password: NEW })).resolves.toBeTruthy();
    await expect(login({ slug: made.b.slug, email: EMAIL, password: OLD })).rejects.toThrow("Wrong email or password");
    await expect(login({ slug: made.c.slug, email: EMAIL, password: OLD })).resolves.toBeTruthy(); // another phone
    expect(await getStaffSessionFromToken(before.token)).toBeUndefined();
    const audit = await withTenant(made.b.id, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entityId, made.b.staffId), eq(auditLog.action, "staff.password.reset"))));
    expect(audit).toHaveLength(1);
  });

  it("refuses a used, wrong or expired code; 5 wrong tries lock the phone for an hour", async () => {
    const wrong = "Wrong or expired code. After 5 wrong tries, wait an hour.";
    await expect(resetPassword({ email: EMAIL, code: lastCode(P), password: NEWER }, { now: at(18) })).rejects.toThrow(wrong);

    await requestReset({ email: EMAIL }, { slug: made.a.slug, send, now: at(40) });
    await expect(resetPassword({ email: EMAIL, code: lastCode(P), password: NEWER }, { slug: made.a.slug, now: at(46) })).rejects.toThrow(wrong); // 6 minutes on

    await requestReset({ email: EMAIL }, { slug: made.a.slug, send, now: at(50) });
    const right = lastCode(P);
    const bad = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expect(resetPassword({ email: EMAIL, code: bad, password: NEWER }, { slug: made.a.slug, now: at(51) })).rejects.toThrow(wrong);
    await expect(resetPassword({ email: EMAIL, code: right, password: NEWER }, { slug: made.a.slug, now: at(52) })).rejects.toThrow(wrong);
    const before = codesTo(P).length;
    await requestReset({ email: EMAIL }, { slug: made.a.slug, send, now: at(53) });
    expect(codesTo(P)).toHaveLength(before); // no codes while locked

    await requestReset({ email: EMAIL }, { slug: made.a.slug, send, now: at(112) });
    const done = await resetPassword({ email: EMAIL, code: lastCode(P), password: NEWER }, { slug: made.a.slug, now: at(113) });
    expect("session" in done && (await getStaffSessionFromToken(done.session.token))?.tenant.id).toBe(made.a.id);
  });

  it("on an academy's own address it covers that academy only", async () => {
    await requestReset({ email: EMAIL }, { slug: made.a.slug, send, now: at(120) });
    await resetPassword({ email: EMAIL, code: lastCode(P), password: OLD }, { slug: made.a.slug, now: at(121) });
    await expect(login({ slug: made.a.slug, email: EMAIL, password: OLD })).resolves.toBeTruthy();
    await expect(login({ slug: made.b.slug, email: EMAIL, password: NEW })).resolves.toBeTruthy(); // B untouched
  });
});

describe("the phone and the code store", () => {
  it("changing one's phone needs the password; a wrong one changes nothing", async () => {
    const ctx = await withTenant(made.c.id, (tx) => loadAccessContext(tx, made.c.staffId));
    expect(await withTenant(made.c.id, (tx) => setOwnPhone(tx, ctx, { phone: "98765 00000", password: "Nope-Nope-1" }))).toBeUndefined();
    expect(await withTenant(made.c.id, (tx) => setOwnPhone(tx, ctx, { phone: "98765 00000", password: OLD }))).toBe("+919876500000");
    await expect(withTenant(made.c.id, (tx) => setOwnPhone(tx, ctx, { phone: "12", password: OLD }))).rejects.toThrow("10-digit");
  });

  it("the app role can't read the codes", async () => {
    const e = await db.execute(sql`SELECT count(*) FROM app.otp_codes`).catch((x: Error) => x);
    expect(e instanceof Error && String(e.cause)).toMatch(/permission denied for table otp_codes/);
  });
});
