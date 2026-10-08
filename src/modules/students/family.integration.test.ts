import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { linkedChildren } from "@/modules/portal/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { addFamilyMember, removeFamilyMember, setManager } from "./family";
import { getGuardian, guardiansOfStudent, upsertFamilyLink } from "./repo";
import { createStudent, KnownGuardianError, lookupKnownGuardian } from "./service";

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
});

afterAll(async () => {
  await deleteTenantsCompletely([T, B].filter(Boolean));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("family members", () => {
  it("a student starts with one manager; family members join the family with access, once each", async () => {
    await withTenant(T, (tx) => addFamilyMember(tx, ctx, studentId, { fullName: "Sara", phone: MUM, relation: "mother" }));
    await withTenant(T, (tx) => addFamilyMember(tx, ctx, studentId, { fullName: "Sara K", phone: MUM, relation: "guardian" }));
    expect((await family()).map((g) => [g.fullName, g.relation, g.isManager])).toEqual([
      ["Imran", "father", true],
      ["Sara", "guardian", false],
    ]);
  });

  it("a number that is a guardian in another family is a question: who they are, then staff decide", async () => {
    const zoya = await admit("Zoya", "Neighbour", NEIGHBOUR);
    const kabir = await admit("Kabir", "Other Parent", phone());
    const add = (linkGuardianId?: string) =>
      withTenant(T, (tx) => addFamilyMember(tx, ctx, kabir.student.id, { fullName: "Xavi", phone: NEIGHBOUR, relation: "guardian", ...(linkGuardianId ? { linkGuardianId } : {}) }));
    const err = await add().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KnownGuardianError);
    expect((err as KnownGuardianError).known).toEqual({ guardianId: zoya.guardian.id, fullName: "Neighbour", phone: zoya.guardian.phone, linked: false, hidden: 0, members: [{ studentId: zoya.student.id, fullName: "Zoya", relation: "father" }] });
    // Nothing happened, and naming someone else is not the answer.
    expect((await withTenant(T, (tx) => guardiansOfStudent(tx, kabir.student.id))).map((g) => g.fullName)).toEqual(["Other Parent"]);
    await expect(add(uuidv7())).rejects.toBeInstanceOf(KnownGuardianError);
    // Staff say it is the same person: linked, and they see both members.
    expect((await add(zoya.guardian.id)).id).toBe(zoya.guardian.id);
    expect((await withTenant(T, (tx) => guardiansOfStudent(tx, kabir.student.id))).map((g) => g.fullName).sort()).toEqual(["Neighbour", "Other Parent"]);
    expect((await withTenant(T, (tx) => linkedChildren(tx, zoya.guardian.id))).map((c) => c.id).sort()).toEqual([zoya.student.id, kabir.student.id].sort());
    expect((await withTenant(T, (tx) => lookupKnownGuardian(tx, ctx, zoya.guardian.phone, kabir.student.id)))?.linked).toBe(true);
    // Once linked, adding them again is not a question.
    await add();
  });

  it("staff limited to one branch are not told who holds a number at another branch", async () => {
    const here = await admit("Mina Here", "Parent Here", phone());
    const branch2 = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Far branch" }))).id;
    const far = await withTenant(T, (tx) => createStudent(tx, ctx, { fullName: "Qasim Faraway", branchId: branch2, guardian: { fullName: "Rukhsar Faraway", phone: phone(), relation: "mother" }, consents: { dataProcessing: true } }));
    const restricted = { ...ctx, branchIds: [here.student.branchId] };
    const farPhone = far.guardian.phone;
    const seen = await withTenant(T, (tx) => lookupKnownGuardian(tx, restricted, farPhone, here.student.id));
    expect(seen).toEqual({ guardianId: "", fullName: "", phone: farPhone, linked: false, members: [], hidden: 1 });
    expect(JSON.stringify(seen)).not.toMatch(/Faraway|Rukhsar|Qasim/);
    const add = (linkGuardianId?: string) =>
      withTenant(T, (tx) => addFamilyMember(tx, restricted, here.student.id, { fullName: "Rukhsar", phone: farPhone, relation: "other", ...(linkGuardianId ? { linkGuardianId } : {}) }));
    const err = await add(far.guardian.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KnownGuardianError);
    expect((err as Error).message).toBe("This number is used at another branch");
    expect(JSON.stringify((err as KnownGuardianError).known)).not.toMatch(/Faraway|Rukhsar|Qasim/);
    expect((await withTenant(T, (tx) => guardiansOfStudent(tx, here.student.id))).map((g) => g.fullName)).toEqual(["Parent Here"]);
    // With an owner's view the same number is a full answer, and linking works.
    expect((await withTenant(T, (tx) => lookupKnownGuardian(tx, ctx, farPhone)))?.members.map((m) => m.fullName)).toEqual(["Qasim Faraway"]);
  });

  it("a guardian seen in one branch shows only the members there, and counts the rest", async () => {
    const here = await admit("Nur Here", "Shared Parent", phone());
    const branch3 = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Third branch" }))).id;
    const far = await withTenant(T, (tx) => createStudent(tx, ctx, { fullName: "Omar Third", branchId: branch3, guardian: { fullName: "Other Third", phone: phone(), relation: "mother" }, consents: { dataProcessing: true } }));
    await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: far.student.id, guardianId: here.guardian.id, relation: "father" }));
    const seen = await withTenant(T, (tx) => lookupKnownGuardian(tx, { ...ctx, branchIds: [here.student.branchId] }, here.guardian.phone));
    expect(seen).toMatchObject({ fullName: "Shared Parent", hidden: 1, members: [{ fullName: "Nur Here" }] });
  });

  it("looking up a number reports the person and their members, or nothing", async () => {
    const dad = (await family())[0];
    const found = await withTenant(T, (tx) => lookupKnownGuardian(tx, ctx, dad?.phone ?? "", studentId));
    expect(found).toMatchObject({ fullName: "Imran", linked: true, members: [{ studentId, fullName: "Ayaan", relation: "father" }] });
    expect(await withTenant(T, (tx) => lookupKnownGuardian(tx, ctx, phone()))).toBeUndefined();
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
