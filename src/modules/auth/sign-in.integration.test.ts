import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStaffSessionFromToken } from "@/lib/auth/session";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { createStaffMember, deactivateStaff, loadAccessContext } from "@/modules/staff/service";
import { tenants } from "@/modules/tenancy/schema";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { handoffHandler } from "./routes";
import { login, redeemHandoff, setPassword, signIn } from "./service";

// The main site's login (agreed 2026-09-25): one email, its academies after
// the right password, and a one-time pass to each academy's own address.

const stamp = Math.random().toString(36).slice(2, 8);
const EMAIL = `coach-${stamp}@example.test`;
const [RIGHT, OTHER] = ["Correct-Horse-9", "Other-Horse-7"];
const made = {} as Record<"a" | "b" | "c" | "d" | "e", { id: string; slug: string; name: string }>;

const academy = async (key: keyof typeof made, password: string) => {
  const slug = `sign-${key}-${stamp}`;
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Sign ${key.toUpperCase()} ${stamp}`, slug, owner: { name: "Owner", email: `owner-${key}-${stamp}@example.test` } });
  made[key] = { id: t.tenant.id, slug, name: t.tenant.name };
  return withTenant(t.tenant.id, async (tx) => {
    const ctx = await loadAccessContext(tx, t.owner.id);
    const coach = await createStaffMember(tx, ctx, { email: EMAIL, fullName: "Ravi Coach" });
    await setPassword(tx, ctx, coach.id, password);
    return { ctx, coach };
  });
};
const tokenOf = (url: string) => new URL(url).searchParams.get("t") ?? "";
const redeem = (slug: string, token: string) => handoffHandler(new Request(`http://${slug}.localhost:3000/api/auth/handoff?t=${token}`, { headers: { host: `${slug}.localhost:3000` } }));

beforeAll(async () => {
  await academy("a", RIGHT);
  await academy("b", RIGHT);
  await academy("c", OTHER);
  await academy("d", RIGHT);
  const e = await academy("e", RIGHT);
  await withTenant(made.e.id, (tx) => deactivateStaff(tx, e.ctx, e.coach.id));
  await withPlatformAdmin({ action: "test.suspend", actorType: "system" }, (tx) => tx.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, made.d.id)));
});

afterAll(async () => {
  await deleteTenantsCompletely(Object.values(made).map((m) => m.id));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("signing in on the main site", () => {
  it("the right password lists each academy it opens; not one with another password, suspended, or where they were turned off", async () => {
    const found = await signIn({ email: EMAIL.toUpperCase(), password: RIGHT });
    expect(found.map((f) => f.name)).toEqual([made.a.name, made.b.name]);
    expect(found[0]?.url).toMatch(new RegExp(`^http://${made.a.slug}\\.localhost:3000/api/auth/handoff\\?t=[A-Za-z0-9_-]{40,}$`));
  });

  it("a wrong password and an unknown email read the same", async () => {
    const wrong = await signIn({ email: EMAIL, password: "Nope-Nope-1" }).catch((e: Error) => e.message);
    const unknown = await signIn({ email: `nobody-${stamp}@example.test`, password: RIGHT }).catch((e: Error) => e.message);
    expect(wrong).toBe("Wrong email or password. After 5 wrong tries, wait 15 minutes.");
    expect(unknown).toBe(wrong);
  });
});

describe("the one-time pass", () => {
  it("opens a session on its own academy's address, once, with a cookie for that address only", async () => {
    const [only] = await signIn({ email: EMAIL, password: OTHER });
    const token = tokenOf(only?.url ?? "");
    const res = await redeem(made.c.slug, token);
    expect([res.status, res.headers.get("location")]).toEqual([303, "/"]);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^bravitar_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
    expect(cookie).not.toMatch(/Domain=/i);
    const session = await getStaffSessionFromToken(decodeURIComponent(cookie.split(";")[0]?.split("=")[1] ?? ""));
    expect(session?.tenant.id).toBe(made.c.id);

    const again = await redeem(made.c.slug, token);
    expect([again.status, again.headers.get("location"), again.headers.get("set-cookie")]).toEqual([303, "/login?expired=1", null]);
  });

  it("is refused on another academy's address and after 2 minutes", async () => {
    const [a, b] = await signIn({ email: EMAIL, password: RIGHT });
    expect((await redeem(made.b.slug, tokenOf(a?.url ?? ""))).headers.get("location")).toBe("/login?expired=1");
    expect(await redeemHandoff(made.b.slug, tokenOf(b?.url ?? ""), {}, { now: new Date(Date.now() + 121_000) })).toBeUndefined();
    expect((await redeem(made.a.slug, tokenOf(a?.url ?? ""))).headers.get("location")).toBe("/");
  });
});

describe("failure limits", () => {
  it("an academy past its 5-in-15-minutes limit is left out; with every one past it, the same message", async () => {
    for (let i = 0; i < 5; i++) await login({ slug: made.a.slug, email: EMAIL, password: "Nope-Nope-1" }).catch(() => undefined);
    expect((await signIn({ email: EMAIL, password: RIGHT })).map((f) => f.name)).toEqual([made.b.name]);
    for (let i = 0; i < 5; i++) await login({ slug: made.b.slug, email: EMAIL, password: "Nope-Nope-1" }).catch(() => undefined);
    await expect(signIn({ email: EMAIL, password: RIGHT })).rejects.toThrow("Wrong email or password.");
  });
});
