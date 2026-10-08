import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as runtimeSql } from "@/lib/db/client";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { attendance } from "@/modules/attendance/schema";
import { addProgram, createBatch } from "@/modules/batches/service";
import { sessions } from "@/modules/sessions/schema";
import { loadAccessContext } from "@/modules/staff/service";
import { staffBranchIds } from "@/modules/staff/repo";
import { createStudent, type StudentCtx } from "./service";
import { updateStudent } from "./repo";
import { studentTrends } from "./trends";

const tag = Math.random().toString(36).slice(2, 8);
const now = new Date("2026-10-15T06:00:00Z");
let T = "";
let U = "";
let ctx: StudentCtx;
let otherCtx: StudentCtx;
let phones = 0;
const phone = () => `+919${String(300_000_000 + ++phones).padStart(9, "0")}`;
const consents = { dataProcessing: true };

const ctxOf = async (tenantId: string, staffId: string): Promise<StudentCtx> => ({
  ...(await withTenant(tenantId, (tx) => loadAccessContext(tx, staffId))),
  branchIds: await withTenant(tenantId, (tx) => staffBranchIds(tx, staffId)),
});
const kid = (tenantId: string, c: StudentCtx, name: string, joinedOn: string) =>
  withTenant(tenantId, async (tx) => (await createStudent(tx, c, { fullName: name, dateOfBirth: "2014-01-01", joinedOn, guardian: { fullName: `${name} P`, phone: phone(), relation: "father" }, consents })).student.id);

beforeAll(async () => {
  const a = await testAcademy({ name: `Trend ${tag}`, slug: `trd-${tag}`, verticalPreset: "karate", owner: { name: "Owner", email: `trd-${tag}@example.test` } });
  const b = await testAcademy({ name: `Trend B ${tag}`, slug: `trb-${tag}`, verticalPreset: "karate", owner: { name: "Other", email: `trb-${tag}@example.test` } });
  [T, U] = [a.tenant.id, b.tenant.id];
  ctx = await ctxOf(T, a.owner.id);
  otherCtx = await ctxOf(U, b.owner.id);
  const ids = [await kid(T, ctx, "Asha", "2026-10-02"), await kid(T, ctx, "Bala", "2026-09-10"), await kid(T, ctx, "Chitra", "2026-09-20"), await kid(T, ctx, "Dev", "2025-12-01"), await kid(T, ctx, "Esha", "2024-01-01")];
  // D left in March; E left before the window opens.
  await withTenant(T, (tx) => updateStudent(tx, ids[3] ?? "", { status: "left", leftOn: "2026-03-05", leftReason: "moved_away" }));
  await withTenant(T, (tx) => updateStudent(tx, ids[4] ?? "", { status: "left", leftOn: "2024-06-01", leftReason: "moved_away" }));
  // Another academy joins four in September: none may show in ours.
  for (const n of ["Wen", "Xan", "Yash", "Zoya"]) await kid(U, otherCtx, n, "2026-09-15");

  const program = await withTenant(T, (tx) => addProgram(tx, ctx, { name: "Karate" }));
  const batch = await withTenant(T, (tx) => createBatch(tx, ctx, { name: "Batch A", programId: program.id, coachId: a.owner.id, slots: [{ weekday: 1, startTime: "17:00", endTime: "18:00" }] }));
  const held = async (date: string) => {
    const [s] = await withTenant(T, (tx) =>
      tx.insert(sessions).values({ id: uuidv7(), tenantId: T, branchId: a.branch.id, batchId: batch.id, startsAt: new Date(`${date}T11:30:00Z`), endsAt: new Date(`${date}T12:30:00Z`), sessionDate: date, status: "held" }).returning({ id: sessions.id }),
    );
    return s?.id ?? "";
  };
  const mark = (sessionId: string, studentId: string, status: "present" | "absent") => withTenant(T, (tx) => tx.insert(attendance).values({ id: uuidv7(), tenantId: T, sessionId, studentId, status }));
  // September: 3 present, 1 absent (75%). October: 1 present (100%). Nothing in other months.
  const sep = await held("2026-09-08");
  for (const i of [0, 1, 2]) await mark(sep, ids[i] ?? "", "present");
  await mark(sep, ids[3] ?? "", "absent");
  await mark(await held("2026-10-06"), ids[0] ?? "", "present");
});

afterAll(async () => {
  await deleteTenantsCompletely([T, U]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

const run = (c: StudentCtx, tenant = T) => withTenant(tenant, (tx) => studentTrends(tx, c, { now }));

describe("studentTrends", () => {
  it("counts who joined and who left, per tenant-local month, over twelve months", async () => {
    const { enrolment } = await run(ctx);
    expect(enrolment.months).toHaveLength(12);
    expect(enrolment.months[0]?.month).toBe("2025-11");
    expect(enrolment.months[11]?.month).toBe("2026-10");
    const at = (m: string) => enrolment.months.find((x) => x.month === m);
    expect(at("2026-09")).toEqual({ month: "2026-09", joined: 2, left: 0 }); // the other academy's four are not here
    expect(at("2026-10")).toEqual({ month: "2026-10", joined: 1, left: 0 });
    expect(at("2025-12")).toEqual({ month: "2025-12", joined: 1, left: 0 });
    expect(at("2026-03")).toEqual({ month: "2026-03", joined: 0, left: 1 });
    expect(enrolment).toMatchObject({ joined: 4, left: 1, net: 3 }); // E joined and left outside the window
  });

  it("attendance by month uses the one rule; a month without classes has no percentage", async () => {
    const { attendance: a } = await run(ctx);
    expect(a?.months).toHaveLength(6);
    expect(a?.months.find((m) => m.month === "2026-09")).toEqual({ month: "2026-09", classes: 1, percent: 75 });
    expect(a?.months.find((m) => m.month === "2026-10")).toEqual({ month: "2026-10", classes: 1, percent: 100 });
    expect(a?.months.find((m) => m.month === "2026-08")).toEqual({ month: "2026-08", classes: 0, percent: null });
    expect(a?.percent).toBe(80);
  });

  it("is a measurement, not a permission: the other academy sees its own four, and a zero is real", async () => {
    const { enrolment } = await withTenant(U, (tx) => studentTrends(tx, otherCtx, { now }));
    expect(enrolment.months.find((m) => m.month === "2026-09")?.joined).toBe(4);
  });

  it("leaves attendance out without attendance:read, and refuses without students:read", async () => {
    const noMarks = { ...ctx, isOwner: false, permissions: ["students:read"] };
    const t = await run(noMarks);
    expect(t.attendance).toBeUndefined();
    expect(t.enrolment.joined).toBe(4);
    await expect(run({ ...ctx, isOwner: false, permissions: ["attendance:read"] })).rejects.toMatchObject({ status: 403 });
  });
});
