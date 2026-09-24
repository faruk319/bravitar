import { pathToFileURL } from "node:url";
import { and, asc, lt, ne } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { sql as runtimeSql } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { todayIn } from "@/lib/dates";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { createBranch, createResource, findTenantBySlug } from "@/modules/tenancy/repo";
import { setPassword } from "@/modules/auth/service";
import { listRoles } from "@/modules/staff/repo";
import { addStaff, createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { addHoliday, addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { generateInvoices } from "@/modules/fees/invoicing";
import { createDiscount, createPlan, giveDiscount, type PlanInput } from "@/modules/fees/service";
import { classRoster, saveAttendance } from "@/modules/attendance/service";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { createStudent, type NewStudentInput, setStudentStatus, type StudentCtx } from "@/modules/students/service";
import { createTenantWithDefaults, type NewTenantInput } from "@/modules/tenancy/service";

// Dev-only login for the seeded owners. Never reuse in production.
const DEMO_PASSWORD = "Demo@1234";

// Demo data for local development. Idempotent by natural key (plan code,
// tenant slug): inserts what is missing, never updates what is there.
const DEMO_TENANTS: (NewTenantInput & { resource: string; coach: { name: string; email: string }; extraBranch?: string })[] = [
  { name: "Shivaji Karate Academy", slug: "shivaji-karate", verticalPreset: "karate", branchName: "Main Dojo", resource: "Main Hall", owner: { name: "Amit Shinde", email: "owner@shivaji-karate.demo" }, coach: { name: "Ravi Patil", email: "coach@shivaji-karate.demo" } },
  { name: "Bright Future Tuition", slug: "bright-future", verticalPreset: "tuition", branchName: "Main Centre", resource: "Room 1", owner: { name: "Farah Khan", email: "owner@bright-future.demo" }, coach: { name: "Sana Shaikh", email: "teacher@bright-future.demo" }, extraBranch: "Kothrud Centre" },
];

// Six students per academy: one family with two siblings, an adult, a paused one.
function demoStudents(vertical: string): (NewStudentInput & { paused?: boolean })[] {
  const interest = vertical === "karate" ? "Beginners" : "Class 9 Maths";
  const consents = { dataProcessing: true, photo: true };
  return [
    { fullName: "Aarav Deshmukh", dateOfBirth: "2015-03-12", gender: "male", guardian: { fullName: "Rakesh Deshmukh", phone: "9876500001", relation: "father" }, programInterest: interest, consents },
    { fullName: "Anaya Deshmukh", dateOfBirth: "2018-07-01", gender: "female", guardian: { fullName: "Rakesh Deshmukh", phone: "9876500001", relation: "father" }, programInterest: interest, consents },
    { fullName: "Zoya Shaikh", dateOfBirth: "2014-11-20", gender: "female", guardian: { fullName: "Sana Shaikh", phone: "9876500002", relation: "mother" }, programInterest: interest, consents: { dataProcessing: true, photo: false } },
    { fullName: "Ishaan Patil", dateOfBirth: "2016-01-30", gender: "male", guardian: { fullName: "Vikram Patil", phone: "9876500003", relation: "father" }, programInterest: interest, consents },
    { fullName: "Meher Kaur", dateOfBirth: "1998-05-05", gender: "female", adultPhone: "9876500004", programInterest: interest, consents },
    { fullName: "Rohan Joshi", dateOfBirth: "2013-09-09", gender: "male", guardian: { fullName: "Priya Joshi", phone: "9876500005", relation: "mother" }, programInterest: interest, consents, paused: true },
  ];
}

type DemoBatch = { name: string; program: string; plan: string; coach: "owner" | "coach"; inExtraBranch?: boolean; withRoom?: boolean; capacity: number; startDate: string; slots: { weekday: number; startTime: string; endTime: string }[]; students: string[] };
const days = (weekdays: number[], startTime: string, endTime: string) => weekdays.map((weekday) => ({ weekday, startTime, endTime }));

// Early Morning (5:30 AM) is there for Prompt 9's timezone test.
function demoBatches(vertical: string): { programs: string[]; plans: PlanInput[]; batches: DemoBatch[] } {
  if (vertical === "karate") {
    return {
      programs: ["Karate"],
      plans: [{ name: "Karate Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "80000", admissionFeePaise: "50000" }],
      batches: [
        { name: "Beginners B", program: "Karate", plan: "Karate Monthly", coach: "coach", withRoom: true, capacity: 30, startDate: "2026-06-01", slots: days([1, 3, 5], "18:00", "19:00"), students: ["Aarav Deshmukh", "Anaya Deshmukh", "Ishaan Patil", "Rohan Joshi"] },
        { name: "Advanced A", program: "Karate", plan: "Karate Monthly", coach: "coach", withRoom: true, capacity: 20, startDate: "2026-06-01", slots: days([1, 3, 5], "19:15", "20:15"), students: ["Zoya Shaikh"] },
        { name: "Early Morning", program: "Karate", plan: "Karate Monthly", coach: "owner", capacity: 15, startDate: "2026-06-01", slots: days([2, 4], "05:30", "06:30"), students: ["Meher Kaur"] },
      ],
    };
  }
  return {
    programs: ["Class 9 Maths", "Class 10 Science"],
    plans: [
      { name: "Maths Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "120000" },
      {
        name: "Science Term",
        kind: "term",
        installments: [
          { label: "1st installment", amountPaise: "600000", dueOffsetDays: 0 },
          { label: "2nd installment", amountPaise: "500000", dueOffsetDays: 90 },
          { label: "3rd installment", amountPaise: "500000", dueOffsetDays: 180 },
        ],
      },
    ],
    batches: [
      { name: "Maths 9 A", program: "Class 9 Maths", plan: "Maths Monthly", coach: "coach", withRoom: true, capacity: 25, startDate: "2026-07-01", slots: [...days([1, 3], "16:00", "17:00"), ...days([6], "10:00", "11:30")], students: ["Aarav Deshmukh", "Zoya Shaikh", "Ishaan Patil", "Rohan Joshi"] },
      { name: "Science 10", program: "Class 10 Science", plan: "Science Term", coach: "coach", inExtraBranch: true, capacity: 20, startDate: "2026-07-01", slots: days([2, 4], "17:00", "18:30"), students: ["Zoya Shaikh", "Meher Kaur"] },
    ],
  };
}

// The last 30 days of classes, marked mostly present with a few absences and
// late arrivals, so Today, the register and profiles have something to show.
async function seedHistory(tx: Tx, ctx: StudentCtx): Promise<void> {
  const now = new Date();
  await reconcileSessions(tx, { now: new Date(now.getTime() - 30 * 86_400_000) });
  await reconcileSessions(tx, { now });
  const past = await tx.select().from(sessions).where(and(lt(sessions.startsAt, now), ne(sessions.status, "cancelled"))).orderBy(asc(sessions.startsAt));
  for (const [day, c] of past.entries()) {
    const at = new Date(c.startsAt.getTime() + 3_600_000);
    const roster = await classRoster(tx, ctx, c.id, { now: at });
    const marks = roster.entries
      .filter((e) => !e.paused)
      .map((e, i) => ({ studentId: e.studentId, status: (i + day) % 9 === 0 ? ("absent" as const) : (i + day) % 13 === 0 ? ("late" as const) : ("present" as const) }));
    if (marks.length) await saveAttendance(tx, ctx, c.id, { marks }, { now: at });
  }
}

// A sibling discount and this month's invoices as drafts, waiting for review.
async function seedFees(tx: Tx, ctx: StudentCtx, studentIds: Map<string, string>): Promise<void> {
  const sibling = await createDiscount(tx, ctx, { name: "Sibling 10%", kind: "percent", value: 10 });
  await createDiscount(tx, ctx, { name: "Scholarship", kind: "percent", value: 100 });
  await giveDiscount(tx, ctx, studentIds.get("Anaya Deshmukh") ?? "", { discountId: sibling.id, reason: "Second child in the family", validFrom: "2026-06-01" });
  const firstOfMonth = `${todayIn("Asia/Kolkata").slice(0, 7)}-01`;
  await generateInvoices(tx, { actorType: "system", tenantId: ctx.tenantId }, { now: new Date(`${firstOfMonth}T04:00:00Z`) });
}

const DEMO_HOLIDAYS = [
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-12-25", name: "Christmas" },
];

export type SeedResult = { plansCreated: string[]; tenantsCreated: string[]; tenantsPresent: string[] };

export async function seed(): Promise<SeedResult> {
  const plansCreated = await withPlatformAdmin({ action: "seed.plans", actorType: "system" }, ensurePlatformPlans);
  const result: SeedResult = { plansCreated, tenantsCreated: [], tenantsPresent: [] };

  for (const { resource, coach, extraBranch, ...input } of DEMO_TENANTS) {
    const existing = await platformRead((tx) => findTenantBySlug(tx, input.slug));
    if (existing) {
      result.tenantsPresent.push(input.slug);
      continue;
    }
    const { tenant, branch, owner } = await createTenantWithDefaults({ actorType: "system" }, input);
    // Through the tenant's own context, like the app would.
    let invite = "";
    await withTenant(tenant.id, async (tx) => {
      const ctx = await loadAccessContext(tx, owner.id);
      await setPassword(tx, ctx, owner.id, DEMO_PASSWORD);
      const room = await createResource(tx, { tenantId: tenant.id, branchId: branch.id, name: resource });
      const second = extraBranch ? await createBranch(tx, { tenantId: tenant.id, name: extraBranch }) : undefined;
      const roles = await listRoles(tx);
      const roleId = (name: string) => roles.filter((r) => r.name === name).map((r) => r.id); // demo data only
      const staff = await createStaffMember(tx, ctx, { email: coach.email, fullName: coach.name, roleIds: roleId("Teacher") });
      await setPassword(tx, ctx, staff.id, DEMO_PASSWORD);
      // A front desk hire who hasn't opened their invite yet.
      const desk = await addStaff(tx, ctx, { email: `desk@${input.slug}.demo`, fullName: "Neha Kulkarni", roleIds: roleId("Front Desk") });
      invite = `http://${input.slug}.localhost:3000/invite/${desk.token}`;

      const sctx: StudentCtx = { ...ctx, branchIds: [] };
      const families = new Map<string, string>(); // guardian phone -> household id
      const studentIds = new Map<string, string>();
      const toPause: string[] = [];
      for (const { paused, ...student } of demoStudents(input.verticalPreset ?? "general")) {
        const phone = student.guardian?.phone ?? student.adultPhone ?? "";
        const householdId = families.get(phone);
        const created = await createStudent(tx, sctx, { ...student, ...(householdId ? { householdId } : {}) });
        families.set(phone, created.household.id);
        studentIds.set(student.fullName, created.student.id);
        if (paused) toPause.push(created.student.id);
      }

      const plan = demoBatches(input.verticalPreset ?? "general");
      const programIds = new Map<string, string>();
      for (const name of plan.programs) programIds.set(name, (await addProgram(tx, sctx, { name })).id);
      const feePlanIds = new Map<string, string>();
      for (const p of plan.plans) feePlanIds.set(p.name, (await createPlan(tx, sctx, p)).id);
      for (const b of plan.batches) {
        const batch = await createBatch(tx, sctx, {
          name: b.name,
          programId: programIds.get(b.program) ?? "",
          coachId: b.coach === "owner" ? owner.id : staff.id,
          ...(b.withRoom ? { resourceId: room.id } : {}),
          ...(b.inExtraBranch && second ? { branchId: second.id } : { branchId: branch.id }),
          capacity: b.capacity,
          defaultFeePlanId: feePlanIds.get(b.plan) ?? null,
          startDate: b.startDate,
          slots: b.slots,
        });
        for (const name of b.students) await enroll(tx, sctx, { studentId: studentIds.get(name) ?? "", batchId: batch.id, startDate: b.startDate });
      }
      // Paused after joining, so their batches show as paused too.
      for (const id of toPause) await setStudentStatus(tx, sctx, id, { status: "paused" });
      await seedHistory(tx, sctx);
      for (const h of DEMO_HOLIDAYS) await addHoliday(tx, sctx, h);
      await seedFees(tx, sctx, studentIds);
    });
    console.log(`seed: ${input.slug} owner ${owner.email} / coach ${coach.email}, password ${DEMO_PASSWORD} (dev only); 6 students, ${demoBatches(input.verticalPreset ?? "general").batches.length} batches`);
    console.log(`seed: ${input.slug} front desk invite (dev only): ${invite}`);
    result.tenantsCreated.push(input.slug);
  }
  return result;
}

async function main(): Promise<void> {
  try {
    const r = await seed();
    console.log(`seed: plans created [${r.plansCreated.join(", ")}]`);
    console.log(`seed: tenants created [${r.tenantsCreated.join(", ")}], already present [${r.tenantsPresent.join(", ")}]`);
  } finally {
    await runtimeSql.end({ timeout: 5 });
    await platformSql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
