import { pathToFileURL } from "node:url";
import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { sql as runtimeSql } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, todayIn } from "@/lib/dates";
import { ConflictError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { split } from "@/lib/money/paise";
import { payToStart } from "@/modules/billing/payments";
import { startActivity } from "@/modules/billing/service";
import { createPlatformAdmin } from "@/modules/platform/auth";
import { platformAdmins } from "@/modules/platform/schema";
import { createBranch, createResource, findTenantBySlug } from "@/modules/tenancy/repo";
import { setPassword } from "@/modules/auth/service";
import { listRoles } from "@/modules/staff/repo";
import { addStaff, createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { addHoliday, addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { generateInvoices } from "@/modules/fees/invoicing";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { createDiscount, createPlan, giveDiscount, issueInvoices, type PlanInput } from "@/modules/fees/service";
import { recordPayment } from "@/modules/payments/service";
import { classRoster, saveAttendance } from "@/modules/attendance/service";
import { createEnquiry, logActivity, markLost } from "@/modules/enquiries/service";
import { bookTrial, trialChoices } from "@/modules/enquiries/trials";
import { queueReminders } from "@/modules/messaging/reminders";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { createStudent, type NewStudentInput, setStudentStatus, type StudentCtx } from "@/modules/students/service";
import { createTenantWithDefaults, type NewTenantInput } from "@/modules/tenancy/service";

// Dev-only login for the seeded owners. Never reuse in production.
const DEMO_PASSWORD = "Demo@1234";
// Dev-only /platform admin (Prompt 21) and its authenticator setup key.
const DEV_ADMIN = { email: "admin@bravitar.demo", fullName: "Bravitar Admin", password: "Demo@1234-platform", secret: "JBSWY3DPEHPK3PXP" };

// Demo data for local development. Idempotent by natural key (tenant slug):
// inserts what is missing, never updates what is there.
const DEMO_TENANTS: (NewTenantInput & { resource: string; coach: { name: string; email: string }; extraBranch?: string })[] = [
  { name: "Shivaji Karate Academy", slug: "shivaji-karate", verticalPreset: "karate", branchName: "Main Dojo", resource: "Main Hall", owner: { name: "Amit Shinde", email: "owner@shivaji-karate.demo", phone: "9800000001" }, coach: { name: "Ravi Patil", email: "coach@shivaji-karate.demo" } },
  { name: "Bright Future Tuition", slug: "bright-future", verticalPreset: "tuition", branchName: "Main Centre", resource: "Room 1", owner: { name: "Farah Khan", email: "owner@bright-future.demo", phone: "9800000002" }, coach: { name: "Sana Shaikh", email: "teacher@bright-future.demo" }, extraBranch: "Kothrud Centre" },
  { name: "Madrasa Noor-ul-Islam", slug: "noor-madrasa", verticalPreset: "deeniyat", branchName: "Masjid-e-Noor", resource: "Prayer Hall", owner: { name: "Abdul Rahim Qureshi", email: "owner@noor-madrasa.demo", phone: "9800000003" }, coach: { name: "Hafiz Imran Ansari", email: "teacher@noor-madrasa.demo" } },
];

// Six students per academy: one family with two siblings, an adult, a paused
// one, a family behind on fees and a child who often misses class (the at-risk
// list). All but the Shaikhs said yes to WhatsApp messages.
type DemoStudent = NewStudentInput & { paused?: boolean; behindOnFees?: boolean; oftenAbsent?: boolean; sibling?: boolean };
function demoStudents(vertical: string): DemoStudent[] {
  const interest = vertical === "karate" ? "Beginners" : "Class 9 Maths";
  const consents = { dataProcessing: true, photo: true, whatsapp: true };
  // A madrasa's own families, on their own phones.
  if (vertical === "deeniyat") {
    return [
      { fullName: "Ayaan Shaikh", dateOfBirth: "2015-04-10", gender: "male", guardian: { fullName: "Salim Shaikh", phone: "9876500011", relation: "father" }, programInterest: "Qaida", consents },
      { fullName: "Maryam Shaikh", dateOfBirth: "2017-08-22", gender: "female", guardian: { fullName: "Salim Shaikh", phone: "9876500011", relation: "father" }, programInterest: "Qaida", consents, sibling: true },
      { fullName: "Zainab Khan", dateOfBirth: "2014-01-15", gender: "female", guardian: { fullName: "Rukhsar Khan", phone: "9876500012", relation: "mother" }, programInterest: "Nazra", consents: { dataProcessing: true, photo: false }, oftenAbsent: true },
      { fullName: "Ibrahim Patel", dateOfBirth: "2016-06-30", gender: "male", guardian: { fullName: "Yusuf Patel", phone: "9876500013", relation: "father" }, programInterest: "Nazra", consents, behindOnFees: true },
      { fullName: "Fatima Ansari", dateOfBirth: "1999-02-11", gender: "female", adultPhone: "9876500014", programInterest: "Hifz", consents },
      { fullName: "Umar Qureshi", dateOfBirth: "2013-11-05", gender: "male", guardian: { fullName: "Nasreen Qureshi", phone: "9876500015", relation: "mother" }, programInterest: "Qaida", consents, paused: true },
    ];
  }
  return [
    { fullName: "Aarav Deshmukh", dateOfBirth: "2015-03-12", gender: "male", guardian: { fullName: "Rakesh Deshmukh", phone: "9876500001", relation: "father" }, programInterest: interest, consents },
    { fullName: "Anaya Deshmukh", dateOfBirth: "2018-07-01", gender: "female", guardian: { fullName: "Rakesh Deshmukh", phone: "9876500001", relation: "father" }, programInterest: interest, consents, sibling: true },
    { fullName: "Zoya Shaikh", dateOfBirth: "2014-11-20", gender: "female", guardian: { fullName: "Sana Shaikh", phone: "9876500002", relation: "mother" }, programInterest: interest, consents: { dataProcessing: true, photo: false }, oftenAbsent: true },
    { fullName: "Ishaan Patil", dateOfBirth: "2016-01-30", gender: "male", guardian: { fullName: "Vikram Patil", phone: "9876500003", relation: "father" }, programInterest: interest, consents, behindOnFees: true },
    { fullName: "Meher Kaur", dateOfBirth: "1998-05-05", gender: "female", adultPhone: "9876500004", programInterest: interest, consents },
    { fullName: "Rohan Joshi", dateOfBirth: "2013-09-09", gender: "male", guardian: { fullName: "Priya Joshi", phone: "9876500005", relation: "mother" }, programInterest: interest, consents, paused: true },
  ];
}

type DemoBatch = { name: string; program: string; plan: string; coach: "owner" | "coach"; inExtraBranch?: boolean; withRoom?: boolean; capacity: number; startDate: string; slots: { weekday: number; startTime: string; endTime: string }[]; students: string[] };
const days = (weekdays: number[], startTime: string, endTime: string) => weekdays.map((weekday) => ({ weekday, startTime, endTime }));

// Early Morning (5:30 AM) is there for Prompt 9's timezone test.
function demoBatches(vertical: string): { programs: string[]; plans: PlanInput[]; batches: DemoBatch[] } {
  if (vertical === "deeniyat") {
    return {
      programs: ["Qaida", "Nazra", "Hifz"],
      plans: [{ name: "Madrasa Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "30000" }],
      batches: [
        { name: "Qaida (Beginners)", program: "Qaida", plan: "Madrasa Monthly", coach: "coach", withRoom: true, capacity: 30, startDate: "2026-06-01", slots: days([1, 2, 3, 4, 6], "17:00", "18:00"), students: ["Ayaan Shaikh", "Maryam Shaikh", "Umar Qureshi"] },
        { name: "Nazra", program: "Nazra", plan: "Madrasa Monthly", coach: "coach", withRoom: true, capacity: 30, startDate: "2026-06-01", slots: days([1, 2, 3, 4, 6], "18:15", "19:15"), students: ["Zainab Khan", "Ibrahim Patel"] },
        { name: "Hifz (Morning)", program: "Hifz", plan: "Madrasa Monthly", coach: "owner", capacity: 15, startDate: "2026-06-01", slots: days([0, 1, 2, 3, 4, 6], "06:00", "07:30"), students: ["Fatima Ansari"] },
      ],
    };
  }
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
async function seedHistory(tx: Tx, ctx: StudentCtx, oftenAbsent: Set<string>): Promise<void> {
  const now = new Date();
  await reconcileSessions(tx, { now: new Date(now.getTime() - 30 * 86_400_000) });
  await reconcileSessions(tx, { now });
  const past = await tx.select().from(sessions).where(and(lt(sessions.startsAt, now), ne(sessions.status, "cancelled"))).orderBy(asc(sessions.startsAt));
  for (const [day, c] of past.entries()) {
    const at = new Date(c.startsAt.getTime() + 3_600_000);
    const roster = await classRoster(tx, ctx, c.id, { now: at });
    const marks = roster.entries
      .filter((e) => !e.paused)
      .map((e, i) => ({ studentId: e.studentId, status: (oftenAbsent.has(e.studentId) ? day % 5 < 3 : (i + day) % 9 === 0) ? ("absent" as const) : (i + day) % 13 === 0 ? ("late" as const) : ("present" as const) }));
    if (marks.length) await saveAttendance(tx, ctx, c.id, { marks }, { now: at });
  }
}

// A sibling discount, then last month's and this month's invoices, each made
// and issued on the 1st as the monthly run would.
async function seedFees(tx: Tx, ctx: StudentCtx, siblingId: string): Promise<void> {
  const sibling = await createDiscount(tx, ctx, { name: "Sibling 10%", kind: "percent", value: 10 });
  await createDiscount(tx, ctx, { name: "Scholarship", kind: "percent", value: 100 });
  await giveDiscount(tx, ctx, siblingId, { discountId: sibling.id, reason: "Second child in the family", validFrom: "2026-06-01" });
  const thisMonth = `${todayIn("Asia/Kolkata").slice(0, 7)}-01`;
  for (const first of [`${addDays(thisMonth, -1).slice(0, 7)}-01`, thisMonth]) {
    const now = new Date(`${first}T04:00:00Z`);
    await generateInvoices(tx, { actorType: "system", tenantId: ctx.tenantId }, { now });
    await issueInvoices(tx, ctx, "all", { now }).catch((e: unknown) => {
      if (!(e instanceof ConflictError)) throw e; // nothing to issue that month
    });
  }
}

// Last month paid by all but the family behind on fees; this month's came in
// over the days, two today (cash, UPI in part), so the register and today's
// collection sheet differ. Their receipts wait under Messages → To send.
async function seedPayments(tx: Tx, ctx: StudentCtx, behind: Set<string>): Promise<void> {
  const today = todayIn("Asia/Kolkata");
  const thisMonth = `${today.slice(0, 7)}-01`;
  const open = (await tx.select().from(invoices).where(inArray(invoices.status, ["issued", "part_paid"])).orderBy(asc(invoices.dueDate), asc(invoices.number))).filter((i) => !behind.has(i.householdId));
  const pay = (inv: Invoice, on: string, method: "cash" | "upi" | "cheque", half = false) => {
    const balance = inv.totalPaise - inv.paidPaise;
    const amount = String(half ? (split(balance, 2)[0] ?? balance) : balance);
    const reference = { cash: "", upi: `UPI 4471 ${on.slice(5).replace("-", "")}`, cheque: "000451" }[method];
    const input = { requestId: uuidv7(), householdId: inv.householdId, branchId: inv.branchId, amountPaise: amount, method, ...(reference ? { reference } : {}), allocations: [{ invoiceId: inv.id, amountPaise: amount }] };
    return recordPayment(tx, ctx, input, on < today ? { now: new Date(`${on}T05:30:00Z`) } : {});
  };
  for (const [i, inv] of open.filter((x) => x.issueDate < thisMonth).entries()) await pay(inv, addDays(inv.issueDate, Math.min(2 + 5 * i, 27)), i % 2 ? "upi" : "cash");
  const [first, second, third] = open.filter((x) => x.issueDate >= thisMonth);
  const fourth = addDays(thisMonth, 3);
  if (first) await pay(first, fourth < today ? fourth : today, "cheque");
  if (second) await pay(second, today, "cash");
  if (third) await pay(third, today, "upi", true);
}

// Five enquiries along the funnel: two new (one due today), one called, one
// with a trial booked, one lost; so the board, Follow-ups and Report show.
async function seedEnquiries(tx: Tx, ctx: StudentCtx, programId: string): Promise<void> {
  const today = todayIn("Asia/Kolkata");
  const add = (name: string, phone: string, source: "walk_in" | "instagram" | "referral" | "whatsapp" | "poster", extra: object = {}) => createEnquiry(tx, ctx, { name, phone, programId, source, ...extra });
  await add("Advait Kulkarni", "9812300001", "walk_in", { nextFollowUp: today });
  await add("Sia Mehta", "9812300002", "instagram", { contactName: "Pooja Mehta" });
  const called = await add("Vihaan Rao", "9812300003", "referral");
  await logActivity(tx, ctx, called.id, { kind: "call", note: "Asked about weekend batches" });
  const trial = await add("Kiara Nair", "9812300004", "whatsapp");
  const [first] = await trialChoices(tx, ctx, trial);
  if (first?.classes[0]) await bookTrial(tx, ctx, trial.id, { sessionId: first.classes[0].sessionId });
  const lost = await add("Arjun Iyer", "9812300005", "poster");
  await markLost(tx, ctx, lost.id, { reason: "timing", note: "Needs mornings" });
}

const DEMO_HOLIDAYS = [
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-12-25", name: "Christmas" },
];

export type SeedResult = { tenantsCreated: string[]; tenantsPresent: string[] };

export async function seed(): Promise<SeedResult> {
  const [admin] = await platformRead((tx) => tx.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, DEV_ADMIN.email)));
  if (!admin) await createPlatformAdmin(DEV_ADMIN, { secret: DEV_ADMIN.secret });
  console.log(`seed: /platform admin ${DEV_ADMIN.email} / ${DEV_ADMIN.password}, authenticator key ${DEV_ADMIN.secret} (dev only)`);
  const result: SeedResult = { tenantsCreated: [], tenantsPresent: [] };

  for (const { resource, coach, extraBranch, ...input } of DEMO_TENANTS) {
    const existing = await platformRead((tx) => findTenantBySlug(tx, input.slug));
    if (existing) {
      result.tenantsPresent.push(input.slug);
      continue;
    }
    const { tenant, branch, owner } = await createTenantWithDefaults({ actorType: "system" }, input);
    // A second branch pays for its activity on its own, with no trial, and
    // first (agreed 2026-09-30): paid by UPI so the demo can use it.
    const second = extraBranch
      ? await withPlatformAdmin({ action: "seed.branch", actorType: "system", tenantId: tenant.id }, async (tx) => {
          const b = await createBranch(tx, { tenantId: tenant.id, name: extraBranch });
          return { branch: b, subscription: await startActivity(tx, { tenantId: tenant.id, branchId: b.id, activityKey: tenant.verticalPreset, today: todayIn(tenant.timezone), trial: false }) };
        })
      : undefined;
    if (second?.subscription.status === "pending") await payToStart({ actorType: "system" }, second.subscription.id);
    // Through the tenant's own context, like the app would.
    let invite = "";
    await withTenant(tenant.id, async (tx) => {
      const ctx = await loadAccessContext(tx, owner.id);
      await setPassword(tx, ctx, owner.id, DEMO_PASSWORD);
      const room = await createResource(tx, { tenantId: tenant.id, branchId: branch.id, name: resource });
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
      let siblingId = "";
      const behind = new Set<string>(); // household ids
      const oftenAbsent = new Set<string>(); // student ids
      for (const { paused, behindOnFees, oftenAbsent: absent, sibling, ...student } of demoStudents(input.verticalPreset ?? "general")) {
        const phone = student.guardian?.phone ?? student.adultPhone ?? "";
        const householdId = families.get(phone);
        const created = await createStudent(tx, sctx, { ...student, ...(householdId ? { householdId } : {}) });
        families.set(phone, created.household.id);
        studentIds.set(student.fullName, created.student.id);
        if (paused) toPause.push(created.student.id);
        if (sibling) siblingId = created.student.id;
        if (behindOnFees) behind.add(created.household.id);
        if (absent) oftenAbsent.add(created.student.id);
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
          ...(b.inExtraBranch && second ? { branchId: second.branch.id } : { branchId: branch.id }),
          capacity: b.capacity,
          defaultFeePlanId: feePlanIds.get(b.plan) ?? null,
          startDate: b.startDate,
          slots: b.slots,
        });
        for (const name of b.students) await enroll(tx, sctx, { studentId: studentIds.get(name) ?? "", batchId: batch.id, startDate: b.startDate });
      }
      // Paused after joining, so their batches show as paused too.
      for (const id of toPause) await setStudentStatus(tx, sctx, id, { status: "paused" });
      await seedHistory(tx, sctx, oftenAbsent);
      for (const h of DEMO_HOLIDAYS) await addHoliday(tx, sctx, h);
      await seedFees(tx, sctx, siblingId);
      await seedPayments(tx, sctx, behind);
      await queueReminders(tx); // what the hourly job would queue now
      await seedEnquiries(tx, sctx, programIds.values().next().value ?? "");
    });
    console.log(`seed: ${input.slug} owner ${owner.email} / coach ${coach.email}, password ${DEMO_PASSWORD} (dev only); 6 students, ${demoBatches(input.verticalPreset ?? "general").batches.length} batches, two months of invoices, payments spread over them`);
    console.log(`seed: ${input.slug} front desk invite (dev only): ${invite}`);
    result.tenantsCreated.push(input.slug);
  }
  return result;
}

async function main(): Promise<void> {
  try {
    const r = await seed();
    console.log("seed: parents sign in with their phone, e.g. 98765 00001 (a parent at both academies); dev prints the code in the server log");
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
