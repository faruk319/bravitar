import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStaffSessionFromToken, type StaffSession } from "@/lib/auth/session";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { listRoles } from "@/modules/staff/repo";
import { createStaffMember, deactivateStaff, loadAccessContext } from "@/modules/staff/service";
import { linkedAcademies, login, redeemHandoff, setPassword, signIn, switchStaffAcademy } from "./service";

// The staff academy switcher (agreed 2026-10-02): only academies this sign-in
// proved, never by email alone.

const stamp = Math.random().toString(36).slice(2, 8);
const EMAIL = `sana-${stamp}@example.test`;
const SAME = "Same-Horse-42";
const OTHER = "Other-Horse-42";
type Made = { id: string; slug: string; name: string; owner: string; staff: string };
const made = {} as Record<"a" | "b" | "c", Made>;

// C's owner adds Sana's email with a password of their own choosing.
const academy = async (key: keyof typeof made, password: string): Promise<void> => {
  const slug = `switch-${key}-${stamp}`;
  const t = await testAcademy({ name: `Switch ${key.toUpperCase()} ${stamp}`, slug, owner: { name: "Owner", email: `owner-${key}-${stamp}@example.test` } });
  const staff = await withTenant(t.tenant.id, async (tx) => {
    const ctx = await loadAccessContext(tx, t.owner.id);
    const roleId = (await listRoles(tx)).find((r) => r.name === "Teacher")?.id ?? "";
    const s = await createStaffMember(tx, ctx, { email: EMAIL, fullName: "Sana", roleId });
    await setPassword(tx, ctx, s.id, password);
    return s.id;
  });
  made[key] = { id: t.tenant.id, slug, name: t.tenant.name, owner: t.owner.id, staff };
};
const sessionFrom = async (slug: string, url: string): Promise<StaffSession | undefined> => {
  const opened = await redeemHandoff(slug, new URL(url).searchParams.get("t") ?? "", {});
  return opened ? getStaffSessionFromToken(opened.token) : undefined;
};

let atA: StaffSession | undefined;

beforeAll(async () => {
  await academy("a", SAME);
  await academy("b", SAME);
  await academy("c", OTHER);
});

afterAll(async () => {
  await deleteTenantsCompletely(Object.values(made).map((m) => m.id));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("staff academy switcher", () => {
  it("main-site sign-in links the academies the password opened, not one with another password", async () => {
    const passes = await signIn({ email: EMAIL, password: SAME });
    expect(passes.map((p) => p.name).sort()).toEqual([made.a.name, made.b.name].sort());
    atA = await sessionFrom(made.a.slug, passes.find((p) => p.name === made.a.name)?.url ?? "");
    expect(atA?.linked).toEqual([made.b.id]);
    expect((await linkedAcademies(atA as StaffSession)).map((x) => x.slug)).toEqual([made.b.slug]);
  });

  it("switching opens the other academy with no password, links back and is audited", async () => {
    const session = atA as StaffSession;
    expect(await switchStaffAcademy(session, made.c.slug)).toBeUndefined();
    const pass = await switchStaffAcademy(session, made.b.slug);
    const atB = await sessionFrom(made.b.slug, pass?.url ?? "");
    expect(atB).toMatchObject({ actor: { id: made.b.staff }, linked: [made.a.id] });
    const logins = await withTenant(made.b.id, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "auth.login")));
    expect(logins.map((r) => r.after)).toContainEqual({ via: "academy switcher" });
  });

  it("signing in at an academy's address links the other academies with the same password", async () => {
    const { token } = await login({ slug: made.a.slug, email: EMAIL, password: SAME });
    expect((await getStaffSessionFromToken(token))?.linked).toEqual([made.b.id]);
  });

  it("an owner who sets a password on someone's email can't switch into their real accounts", async () => {
    const { token } = await login({ slug: made.c.slug, email: EMAIL, password: OTHER });
    const atC = (await getStaffSessionFromToken(token)) as StaffSession;
    expect(atC.linked).toEqual([]);
    expect(await switchStaffAcademy(atC, made.a.slug)).toBeUndefined();
  });

  it("Bravitar support can't switch, and a deactivated account drops out", async () => {
    const session = atA as StaffSession;
    expect(await switchStaffAcademy({ ...session, impersonation: { by: made.a.owner, reason: "Check" } }, made.b.slug)).toBeUndefined();
    await withTenant(made.b.id, async (tx) => deactivateStaff(tx, await loadAccessContext(tx, made.b.owner), made.b.staff));
    expect(await linkedAcademies(session)).toEqual([]);
    expect(await switchStaffAcademy(session, made.b.slug)).toBeUndefined();
  });
});
