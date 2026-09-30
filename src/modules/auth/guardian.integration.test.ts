import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { getGuardianSessionFromToken } from "@/lib/auth/session";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { loadAccessContext } from "@/modules/staff/service";
import { updateGuardian } from "@/modules/students/repo";
import { createStudent } from "@/modules/students/service";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import type { CodeSender } from "./codes";
import { otherAcademies, requestPortalCode, switchAcademy, verifyPortalCode } from "./guardian";
import { logoutHandler } from "./routes";
import { redeemHandoff } from "./service";

// Prompt 20: parents and adult students sign in with a WhatsApp code. One
// code on the main site offers every academy with the number; each pass opens
// only its own academy. The code limits themselves are the database's (reset tests).

const stamp = Math.random().toString(36).slice(2, 8);
const digits = () => String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
const P = `+9195${digits()}`; // a parent at A and B
const Q = `+9194${digits()}`; // a parent at C only
const made = {} as Record<"a" | "b" | "c", { id: string; slug: string; name: string; guardianId: string }>;
const got: { phone: string; code: string }[] = [];
const send: CodeSender = async (phone, code) => {
  got.push({ phone, code });
};
const T0 = new Date("2031-04-04T05:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const lastCode = (phone: string) => got.filter((g) => g.phone === phone).at(-1)?.code ?? "";
const tokenOf = (url: string) => new URL(url).searchParams.get("t") ?? "";

beforeAll(async () => {
  for (const [key, phone] of [["a", P], ["b", P], ["c", Q]] as const) {
    const slug = `parent-${key}-${stamp}`;
    const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Parent ${key.toUpperCase()} ${stamp}`, slug, owner: { name: "Owner", email: `parent-${key}-${stamp}@example.test` } });
    const created = await withTenant(t.tenant.id, async (tx) => createStudent(tx, { ...(await loadAccessContext(tx, t.owner.id)), branchIds: [] }, { fullName: `Child ${key}`, guardian: { fullName: "Rekha Joshi", phone, relation: "mother" }, consents: { dataProcessing: true } }));
    made[key] = { id: t.tenant.id, slug, name: t.tenant.name, guardianId: created.guardian.id };
  }
});

afterAll(async () => {
  await deleteTenantsCompletely(Object.values(made).map((m) => m.id));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the code", () => {
  it("goes only to a registered number, with the same answer for any number", async () => {
    await requestPortalCode({ phone: P }, { send, now: at(0) });
    await expect(requestPortalCode({ phone: `+9193${digits()}` }, { send, now: at(0) })).resolves.toBeUndefined();
    await expect(requestPortalCode({ phone: Q }, { slug: made.a.slug, send, now: at(0) })).resolves.toBeUndefined(); // not a parent at A
    expect(got.map((g) => g.phone)).toEqual([P]);
    await expect(verifyPortalCode({ phone: P, code: "000000" }, { now: at(1) })).rejects.toThrow("Wrong or expired code");
  });
});

describe("signing in", () => {
  it("on an academy's address, the code signs in there, once", async () => {
    await requestPortalCode({ phone: P }, { slug: made.a.slug, send, now: at(20) });
    const code = lastCode(P);
    const done = await verifyPortalCode({ phone: P, code }, { slug: made.a.slug, now: at(21) });
    const session = await getGuardianSessionFromToken("token" in done ? done.token : "");
    expect(session).toMatchObject({ actor: { type: "guardian", id: made.a.guardianId, name: "Rekha Joshi" }, tenant: { id: made.a.id }, phone: P });
    await expect(verifyPortalCode({ phone: P, code }, { slug: made.a.slug, now: at(22) })).rejects.toThrow("Wrong or expired code");
  });

  it("on the main site, one code offers every academy with the number; each pass opens only its own", async () => {
    await requestPortalCode({ phone: P }, { send, now: at(40) });
    const done = await verifyPortalCode({ phone: P, code: lastCode(P) }, { now: at(41) });
    const academies = "academies" in done ? done.academies : [];
    expect(academies.map((a) => a.name).sort()).toEqual([made.a.name, made.b.name].sort());
    const toA = academies.find((a) => a.name === made.a.name)?.url ?? "";
    expect(await redeemHandoff(made.b.slug, tokenOf(toA), {})).toBeUndefined();
    const opened = await redeemHandoff(made.a.slug, tokenOf(toA), {});
    expect(opened?.home).toBe("/portal");
    expect((await getGuardianSessionFromToken(opened?.token ?? ""))?.tenant.id).toBe(made.a.id);
  });
});

describe("switch academy", () => {
  it("opens another academy with the number the code proved, only where it is a parent", async () => {
    expect((await otherAcademies(P, made.a.id)).map((a) => a.slug)).toEqual([made.b.slug]);
    const pass = await switchAcademy(P, made.b.slug);
    const opened = await redeemHandoff(made.b.slug, tokenOf(pass?.url ?? ""), {});
    expect((await getGuardianSessionFromToken(opened?.token ?? ""))?.tenant.id).toBe(made.b.id);
    expect(await switchAcademy(P, made.c.slug)).toBeUndefined();
  });
});

describe("access ends", () => {
  it("with sign-out, and at once when the academy turns the parent's login off", async () => {
    await requestPortalCode({ phone: Q }, { slug: made.c.slug, send, now: at(60) });
    const first = await verifyPortalCode({ phone: Q, code: lastCode(Q) }, { slug: made.c.slug, now: at(61) });
    const token = "token" in first ? first.token : "";
    const out = await logoutHandler(new Request(`http://${made.c.slug}.localhost:3000/api/auth/logout`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
    expect(out.status).toBe(200);
    expect(await getGuardianSessionFromToken(token)).toBeUndefined();

    await requestPortalCode({ phone: Q }, { slug: made.c.slug, send, now: at(62) });
    const again = await verifyPortalCode({ phone: Q, code: lastCode(Q) }, { slug: made.c.slug, now: at(63) });
    await withTenant(made.c.id, (tx) => updateGuardian(tx, made.c.guardianId, { canLogin: false }));
    expect(await getGuardianSessionFromToken("token" in again ? again.token : "")).toBeUndefined();
    got.length = 0;
    await requestPortalCode({ phone: Q }, { send, now: at(80) });
    expect(got).toEqual([]); // no academy left for this number
  });
});
