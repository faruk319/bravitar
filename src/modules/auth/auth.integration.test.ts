import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { json, withStaffRequest } from "@/lib/auth/route";
import { hashToken, newToken } from "@/lib/auth/token";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { insertSession } from "@/modules/auth/repo";
import { loginHandler, logoutHandler, meHandler, slugFromHost } from "@/modules/auth/routes";
import { loginAttempts, sessionsAuth } from "@/modules/auth/schema";
import { LOGIN_MAX_FAILURES, login, setPassword } from "@/modules/auth/service";
import { listRoles } from "@/modules/staff/repo";
import type { Role, StaffUser } from "@/modules/staff/schema";
import { createStaffMember, deactivateStaff, loadAccessContext, setRolePermissions, setStaffRoles } from "@/modules/staff/service";
import { tenants } from "@/modules/tenancy/schema";
import { createTenantWithDefaults, setTenantModules } from "@/modules/tenancy/service";

const stamp = Math.random().toString(36).slice(2, 8);
const slugA = `auth-a-${stamp}`;
const slugB = `auth-b-${stamp}`;
const email = `owner-${stamp}@example.test`;
const PASSWORD = "Correct-Horse-9";
let A = "";
let B = "";
let ownerA: StaffUser;
let teacher: StaffUser;
let roles: Record<string, Role> = {};

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://${slugA}.localhost:3000${path}`, { method: "POST", headers: { host: `${slugA}.localhost:3000`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (path: string, cookie?: string) => new Request(`http://${slugA}.localhost:3000${path}`, { headers: cookie ? { cookie } : {} });
const cookieOf = (res: Response) => {
  const header = res.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
};
const feesRoute = withStaffRequest("fees:collect", async ({ session }) => json({ ok: session.actor.id }));

beforeAll(async () => {
  const a = await createTenantWithDefaults({ actorType: "system" }, { name: `Auth A ${stamp}`, slug: slugA, verticalPreset: "karate", owner: { name: "Owner A", email } });
  const b = await createTenantWithDefaults({ actorType: "system" }, { name: `Auth B ${stamp}`, slug: slugB, owner: { name: "Owner B", email } });
  A = a.tenant.id;
  B = b.tenant.id;
  ownerA = a.owner;
  roles = Object.fromEntries((await withTenant(A, listRoles)).map((r) => [r.name, r]));
  await withTenant(A, async (tx) => {
    const ctx = await loadAccessContext(tx, ownerA.id);
    teacher = await createStaffMember(tx, ctx, { email: `teacher-${stamp}@example.test`, fullName: "Teacher", roleIds: [roles.Teacher?.id ?? ""] });
    await setPassword(tx, ctx, teacher.id, PASSWORD);
  });
});

afterAll(async () => {
  await deleteTenantsCompletely([A, B]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("login", () => {
  it("refuses an account that has no password yet", async () => {
    const res = await loginHandler(post("/api/auth/login", { email, password: "anything-at-all" }));
    expect(res.status).toBe(401);
  });

  it("logs a seeded owner in and returns the docs/01 payload with tenant, branch ids and owner flag", async () => {
    await withTenant(A, async (tx) => setPassword(tx, await loadAccessContext(tx, ownerA.id), ownerA.id, PASSWORD));
    const res = await loginHandler(post("/api/auth/login", { email, password: PASSWORD }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{40,}; Path=/; HttpOnly; SameSite=Lax; Max-Age=`));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ actor: { type: "staff", id: ownerA.id, name: "Owner A" }, tenant: { id: A, slug: slugA, timezone: "Asia/Kolkata" }, isOwner: true, permissions: [] });
    expect(body.branchIds).toEqual([]); // no rows = all branches
    expect((body.modules as Record<string, boolean>).core).toBe(true);
    const token = cookieOf(res).split("=")[1] ?? "";
    const [row] = await platformDb.select({ h: sessionsAuth.tokenHash, t: sessionsAuth.tenantId }).from(sessionsAuth).where(eq(sessionsAuth.tokenHash, hashToken(token)));
    expect(row?.t).toBe(A); // only the hash is stored
  });

  it("returns the same 401 for a wrong password and for an unknown email, and records both attempts", async () => {
    const wrong = await loginHandler(post("/api/auth/login", { email, password: "nope-nope-nope" }));
    const unknown = await loginHandler(post("/api/auth/login", { email: `ghost-${stamp}@example.test`, password: "nope-nope-nope" }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    const rows = await platformDb.select({ e: loginAttempts.email, ok: loginAttempts.succeeded }).from(loginAttempts).where(eq(loginAttempts.tenantId, A));
    expect(rows.filter((r) => !r.ok).length).toBeGreaterThanOrEqual(2);
  });

  it("locks the email after 5 failures, even with the correct password", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await loginHandler(post("/api/auth/login", { email: teacher.email, password: "wrong-" + i }));
    const res = await loginHandler(post("/api/auth/login", { email: teacher.email, password: PASSWORD }));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/Too many failed attempts/);
  });

  it("is tenant-scoped: the same email in tenant B has its own password", async () => {
    await expect(login({ slug: slugB, email, password: PASSWORD })).rejects.toMatchObject({ status: 401 });
    const b = await login({ slug: slugA, email, password: PASSWORD });
    expect(b.context.tenant.id).toBe(A);
  });

  it("derives the slug from the host, falling back to the body", () => {
    expect(slugFromHost("shivaji-karate.localhost:3000", "localhost:3000")).toBe("shivaji-karate");
    expect(slugFromHost("localhost:3000", "localhost:3000")).toBeUndefined();
    expect(slugFromHost("a.b.localhost:3000", "localhost:3000")).toBeUndefined();
    expect(slugFromHost("evil.com", "localhost:3000")).toBeUndefined();
  });
});

describe("session lifecycle", () => {
  const signIn = async () => cookieOf(await loginHandler(post("/api/auth/login", { email, password: PASSWORD })));

  it("/me answers with the cached payload, and logout revokes the session immediately", async () => {
    const cookie = await signIn();
    expect((await meHandler(get("/api/auth/me", cookie))).status).toBe(200);
    const out = await logoutHandler(new Request(`http://${slugA}.localhost:3000/api/auth/logout`, { method: "POST", headers: { cookie } }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await meHandler(get("/api/auth/me", cookie))).status).toBe(401);
  });

  it("rejects a missing, forged, or database-leaked (hashed) token", async () => {
    expect((await meHandler(get("/api/auth/me"))).status).toBe(401);
    expect((await meHandler(get("/api/auth/me", `${SESSION_COOKIE}=${newToken()}`))).status).toBe(401);
    const cookie = await signIn();
    const token = cookie.split("=")[1] ?? "";
    expect((await meHandler(get("/api/auth/me", `${SESSION_COOKIE}=${hashToken(token)}`))).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const token = newToken();
    await withTenant(A, (tx) =>
      insertSession(tx, { tokenHash: hashToken(token), actorType: "staff", actorId: ownerA.id, tenantId: A, cachedContext: null, expiresAt: new Date(Date.now() - 1000) }),
    );
    expect((await meHandler(get("/api/auth/me", `${SESSION_COOKIE}=${token}`))).status).toBe(401);
  });

  it("deactivating a staff member kills every one of their sessions on the very next request", async () => {
    // the teacher's email is rate-limited by the lockout test above; use a fresh staff member
    const victim = await withTenant(A, async (tx) => {
      const ctx = await loadAccessContext(tx, ownerA.id);
      const v = await createStaffMember(tx, ctx, { email: `victim-${stamp}@example.test`, fullName: "Victim", roleIds: [roles.Teacher?.id ?? ""] });
      await setPassword(tx, ctx, v.id, PASSWORD);
      return v;
    });
    const s1 = await login({ slug: slugA, email: victim.email, password: PASSWORD });
    const s2 = await login({ slug: slugA, email: victim.email, password: PASSWORD });
    const c1 = `${SESSION_COOKIE}=${s1.token}`;
    const c2 = `${SESSION_COOKIE}=${s2.token}`;
    expect((await meHandler(get("/api/auth/me", c1))).status).toBe(200);
    await withTenant(A, async (tx) => deactivateStaff(tx, await loadAccessContext(tx, ownerA.id), victim.id));
    expect((await meHandler(get("/api/auth/me", c1))).status).toBe(401);
    expect((await meHandler(get("/api/auth/me", c2))).status).toBe(401);
  });
});

describe("cache invalidation", () => {
  it("role assignment, role permission edits and module changes all show on the next request", async () => {
    const member = await withTenant(A, async (tx) => {
      const ctx = await loadAccessContext(tx, ownerA.id);
      const m = await createStaffMember(tx, ctx, { email: `member-${stamp}@example.test`, fullName: "Member", roleIds: [roles.Teacher?.id ?? ""] });
      await setPassword(tx, ctx, m.id, PASSWORD);
      return m;
    });
    const { token } = await login({ slug: slugA, email: member.email, password: PASSWORD });
    const cookie = `${SESSION_COOKIE}=${token}`;
    const me = async () => (await (await meHandler(get("/api/auth/me", cookie))).json()) as { permissions: string[]; modules: Record<string, boolean> };
    expect((await me()).permissions).not.toContain("fees:collect");

    await withTenant(A, async (tx) => setStaffRoles(tx, await loadAccessContext(tx, ownerA.id), member.id, [roles["Front Desk"]?.id ?? ""]));
    expect((await me()).permissions).toContain("fees:collect");

    await withTenant(A, async (tx) => setRolePermissions(tx, await loadAccessContext(tx, ownerA.id), roles["Front Desk"]?.id ?? "", ["students:read"]));
    expect((await me()).permissions).toEqual(["students:read"]);

    const [t] = await platformDb.select({ m: tenants.enabledModules }).from(tenants).where(eq(tenants.id, A));
    await setTenantModules({ actorType: "system" }, A, { ...t?.m, students: false });
    expect((await me()).modules.students).toBe(false);
    await setTenantModules({ actorType: "system" }, A, { ...t?.m, students: true });
    expect((await me()).modules.students).toBe(true);
  });
});

describe("route helper", () => {
  it("a Teacher gets 403 on a fees route, the owner gets 200, no cookie gets 401", async () => {
    const ownerCookie = cookieOf(await loginHandler(post("/api/auth/login", { email, password: PASSWORD })));
    const t = await withTenant(A, async (tx) => {
      const ctx = await loadAccessContext(tx, ownerA.id);
      const s = await createStaffMember(tx, ctx, { email: `t2-${stamp}@example.test`, fullName: "Teacher 2", roleIds: [roles.Teacher?.id ?? ""] });
      await setPassword(tx, ctx, s.id, PASSWORD);
      return s;
    });
    const teacherCookie = `${SESSION_COOKIE}=${(await login({ slug: slugA, email: t.email, password: PASSWORD })).token}`;
    expect((await feesRoute(get("/api/fees/collect", teacherCookie))).status).toBe(403);
    expect((await feesRoute(get("/api/fees/collect", ownerCookie))).status).toBe(200);
    expect((await feesRoute(get("/api/fees/collect"))).status).toBe(401);
  });
});
