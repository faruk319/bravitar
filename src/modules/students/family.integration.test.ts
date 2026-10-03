import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { linkedChildren } from "@/modules/portal/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { addFamilyMember, removeFamilyMember, setManager } from "./family";
import { getGuardian, guardiansOfStudent } from "./repo";
import { createStudent } from "./service";

// Family access (agreed 2026-10-03): family members with access to a
// student, one of them the manager; removing access keeps the record.

const stamp = Math.random().toString(36).slice(2, 8);
const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const [DAD, MUM, NEIGHBOUR] = [phone(), phone(), phone()];
let T = "";
let B = "";
let ctx: ScopedCtx;
let ctxB: ScopedCtx;
let studentId = "";
let householdId = "";

const academy = async (key: string) => {
  const t = await testAcademy({ name: `Family ${key} ${stamp}`, slug: `family-${key}-${stamp}`, owner: { name: "Owner", email: `family-${key}-${stamp}@example.test` } });
  return { id: t.tenant.id, ctx: { ...(await withTenant(t.tenant.id, (tx) => loadAccessContext(tx, t.owner.id))), branchIds: [] } };
};
const family = () => withTenant(T, (tx) => guardiansOfStudent(tx, studentId));
const admit = (fullName: string, guardian: string, number: string) =>
  withTenant(T, (tx) => createStudent(tx, ctx, { fullName, guardian: { fullName: guardian, phone: number, relation: "father" }, consents: { dataProcessing: true } }));

beforeAll(async () => {
  ({ id: T, ctx } = await academy("a"));
  ({ id: B, ctx: ctxB } = await academy("b"));
  const made = await admit("Ayaan", "Imran", DAD);
  studentId = made.student.id;
  householdId = made.student.householdId;
});

afterAll(async () => {
  await deleteTenantsCompletely([T, B].filter(Boolean));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("family members", () => {
  it("a student starts with one manager; family members join the family with access, once each", async () => {
    const mum = await withTenant(T, (tx) => addFamilyMember(tx, ctx, studentId, { fullName: "Sara", phone: MUM, relation: "mother" }));
    expect(mum.householdId).toBe(householdId);
    await withTenant(T, (tx) => addFamilyMember(tx, ctx, studentId, { fullName: "Sara K", phone: MUM, relation: "guardian" }));
    expect((await family()).map((g) => [g.fullName, g.relation, g.isManager])).toEqual([
      ["Imran", "father", true],
      ["Sara", "guardian", false],
    ]);
  });

  it("a number from another family here is refused", async () => {
    await admit("Zoya", "Neighbour", NEIGHBOUR);
    await expect(withTenant(T, (tx) => addFamilyMember(tx, ctx, studentId, { fullName: "Xavi", phone: NEIGHBOUR, relation: "cousin" }))).rejects.toThrow("This number belongs to another family here");
  });

  it("the manager moves; neither the manager nor the family's main contact can be removed", async () => {
    const [dad, mum] = await family();
    await withTenant(T, (tx) => setManager(tx, ctx, studentId, mum?.id ?? ""));
    expect((await family()).map((g) => [g.id, g.isManager])).toEqual([
      [mum?.id, true],
      [dad?.id, false],
    ]);
    await expect(withTenant(T, (tx) => removeFamilyMember(tx, ctx, studentId, mum?.id ?? ""))).rejects.toThrow("Make someone else the manager first");
    await expect(withTenant(T, (tx) => removeFamilyMember(tx, ctx, studentId, dad?.id ?? ""))).rejects.toThrow("main contact");
    await withTenant(T, (tx) => setManager(tx, ctx, studentId, dad?.id ?? ""));
  });

  it("removing someone ends their access to the student, keeps their record, and they can be added back", async () => {
    const mum = (await family()).find((g) => !g.isManager);
    await withTenant(T, (tx) => removeFamilyMember(tx, ctx, studentId, mum?.id ?? ""));
    expect((await family()).map((g) => g.id)).not.toContain(mum?.id);
    expect(await withTenant(T, (tx) => linkedChildren(tx, mum?.id ?? ""))).toEqual([]);
    expect((await withTenant(T, (tx) => getGuardian(tx, mum?.id ?? "")))?.id).toBe(mum?.id);
    await withTenant(T, (tx) => addFamilyMember(tx, ctx, studentId, { fullName: "Sara", phone: MUM, relation: "mother" }));
    expect((await withTenant(T, (tx) => linkedChildren(tx, mum?.id ?? ""))).map((c) => c.id)).toEqual([studentId]);
    const actions = (await withTenant(T, (tx) => tx.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, studentId)))).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["family.add", "family.manager.set", "family.remove"]));
  });

  it("another academy's student is not found", async () => {
    await expect(withTenant(B, (tx) => addFamilyMember(tx, ctxB, studentId, { fullName: "Xavi", phone: phone(), relation: "friend" }))).rejects.toThrow("not found");
  });
});
