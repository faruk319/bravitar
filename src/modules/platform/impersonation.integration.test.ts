import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { getStaffSessionFromToken } from "@/lib/auth/session";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformRead, platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { logoutHandler } from "@/modules/auth/routes";
import { sessionsAuth } from "@/modules/auth/schema";
import { IMPERSONATION_SECONDS, openSession, redeemHandoff } from "@/modules/auth/service";
import { addProgramRoute } from "@/modules/batches/routes";
import { academyDetail, createAcademy, impersonate, setAcademyStatus } from "./academies";

// Prompt 21: Bravitar support opens an academy as its owner. Read-write, for
// 2 hours, and never silent: every change carries impersonated_by.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const ADMIN = { actorType: "platform" as const, actorId: uuidv7() };
const SLUG = `imp-${stamp}`;
const OTHER = `imp-other-${stamp}`;
let tenantId = "";
let otherId = "";
let token = "";

const academy = (slug: string) => createAcademy(ME, { name: `Imp ${slug}`, slug, verticalPreset: "karate", owner: { name: "Imp Owner", email: `${slug}@example.test` } });
const call = (handler: (req: Request) => Promise<Response>, session: string, path: string, body?: unknown) =>
  handler(new Request(`http://${SLUG}.localhost:3000${path}`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${session}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
const audits = (action: string) => withTenant(tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, action))); // the academy's own view

beforeAll(async () => {
  tenantId = (await academy(SLUG)).id;
  otherId = (await academy(OTHER)).id;
});

afterAll(async () => {
  await deleteTenantsCompletely([tenantId, otherId].filter(Boolean));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("opening an academy as its owner", () => {
  it("needs a reason; the pass works once, only at that academy's address, for a 2-hour owner session", async () => {
    await expect(impersonate(ADMIN, tenantId, { reason: " " })).rejects.toThrow("Give a reason");
    const url = await impersonate(ADMIN, tenantId, { reason: "Help with fees" });
    expect(url).toMatch(new RegExp(`^http://${SLUG}\\.`));
    const pass = new URL(url).searchParams.get("t") ?? "";
    expect(await redeemHandoff(OTHER, pass, {})).toBeUndefined();
    token = (await redeemHandoff(SLUG, pass, {}))?.token ?? "";
    expect(await redeemHandoff(SLUG, pass, {})).toBeUndefined();
    const session = await getStaffSessionFromToken(token);
    expect(session).toMatchObject({ isOwner: true, impersonation: { by: ADMIN.actorId, reason: "Help with fees" } });
    const [row] = await platformRead((tx) => tx.select().from(sessionsAuth).where(eq(sessionsAuth.id, session?.sessionId ?? "")));
    expect(Math.abs((row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0) - IMPERSONATION_SECONDS * 1000)).toBeLessThan(10_000);
  });

  it("puts the start, with its reason, in the academy's own audit log", async () => {
    const [start] = await audits("impersonation.start");
    expect(start).toMatchObject({ actorType: "platform", actorId: ADMIN.actorId, after: { reason: "Help with fees" } });
    expect((await audits("auth.login")).filter((r) => r.impersonatedBy === ADMIN.actorId)).toHaveLength(1);
  });

  it("tags every change made during it, and only those", async () => {
    expect((await call(addProgramRoute, token, "/api/programs", { name: `Kata ${stamp}` })).status).toBe(201);
    const owner = (await academyDetail(tenantId)).owner?.id ?? "";
    const own = await withTenant(tenantId, (tx) => openSession(tx, tenantId, owner, {}));
    expect((await call(addProgramRoute, own.token, "/api/programs", { name: `Kumite ${stamp}` })).status).toBe(201);
    const made = await audits("program.create");
    expect(made.map((r) => [(r.after as { name: string }).name, r.impersonatedBy])).toEqual(
      expect.arrayContaining([
        [`Kata ${stamp}`, ADMIN.actorId],
        [`Kumite ${stamp}`, null],
      ]),
    );
  });

  it("ends with End: signed out, and that is tagged too", async () => {
    expect((await call(logoutHandler, token, "/api/auth/logout")).status).toBe(200);
    expect(await getStaffSessionFromToken(token)).toBeUndefined();
    const out = await platformRead((tx) => tx.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, "auth.logout"))));
    expect(out.map((r) => r.impersonatedBy)).toEqual([ADMIN.actorId]);
  });

  it("is refused while the academy is suspended", async () => {
    await setAcademyStatus(ME, tenantId, { status: "suspended", reason: "Check" });
    await expect(impersonate(ADMIN, tenantId, { reason: "Look around" })).rejects.toThrow("Restore it first");
    await setAcademyStatus(ME, tenantId, { status: "active", reason: "Check" });
  });
});
