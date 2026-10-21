import { pathToFileURL } from "node:url";
import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { sql as runtimeSql } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, todayIn } from "@/lib/dates";
import { addMonths } from "@/modules/fees/billing";
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
import { updateEnrollment } from "@/modules/enrollments/repo";
import { enroll } from "@/modules/enrollments/service";
import { generateInvoices } from "@/modules/fees/invoicing";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { createDiscount, createPlan, giveDiscount, issueInvoices, type PlanInput, saveFeeSettings } from "@/modules/fees/service";
import { recordPayment, refundPayment } from "@/modules/payments/service";
import { classRoster, saveAttendance } from "@/modules/attendance/service";
import { createEnquiry, logActivity, markLost } from "@/modules/enquiries/service";
import { bookTrial, trialChoices } from "@/modules/enquiries/trials";
import { queueReminders } from "@/modules/messaging/reminders";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { createGuardian, linkGuardian } from "@/modules/students/repo";
import { createStudent, type NewStudentInput, setStudentStatus, type StudentCtx } from "@/modules/students/service";
import { createTenantWithDefaults, type NewTenantInput } from "@/modules/tenancy/service";

// Dev-only login for the seeded owners. Never reuse in production.
const DEMO_PASSWORD = "Demo@1234";
// Dev-only /platform admin (Prompt 21) and its authenticator setup key.
const DEV_ADMIN = { email: "admin@bravitar.demo", fullName: "Bravitar Admin", password: "Demo@1234-platform", secret: "JBSWY3DPEHPK3PXP" };

// Demo data for local development. Idempotent by natural key (tenant slug):
// inserts what is missing, never updates what is there.
const DEMO_TENANTS: (NewTenantInput & { resource: string; coach: { name: string; email: string }; extraBranch?: string; extraModule?: string; alsoCoach?: { name: string; email: string }; autoIssue?: boolean })[] = [
  { name: "Shivaji Karate Academy", slug: "shivaji-karate", verticalPreset: "karate", branchName: "Main Dojo", resource: "Main Hall", owner: { name: "Amit Shinde", email: "owner@shivaji-karate.demo", phone: "9800000001" }, coach: { name: "Ravi Patil", email: "coach@shivaji-karate.demo" } },
  { name: "Bright Future Tuition", slug: "bright-future", verticalPreset: "tuition", branchName: "Main Centre", resource: "Room 1", owner: { name: "Farah Khan", email: "owner@bright-future.demo", phone: "9800000002" }, coach: { name: "Sana Shaikh", email: "teacher@bright-future.demo" }, extraBranch: "Kothrud Centre", autoIssue: true },
  { name: "Madrasa Noor-ul-Islam", slug: "noor-madrasa", verticalPreset: "deeniyat", branchName: "Masjid-e-Noor", resource: "Prayer Hall", owner: { name: "Abdul Rahim Qureshi", email: "owner@noor-madrasa.demo", phone: "9800000003" }, coach: { name: "Hafiz Imran Ansari", email: "teacher@noor-madrasa.demo" }, extraModule: "tuition", alsoCoach: { name: "Sana Shaikh", email: "teacher@bright-future.demo" } },
];

// Six students per academy: one family with two siblings, an adult, a paused
// one, a family behind on fees and a child who often misses class (the at-risk
// list). All but the Shaikhs said yes to WhatsApp messages. The karate academy
// has a fuller roll that joined over eight months, and one still waiting for a batch.
type DemoStudent = NewStudentInput & { paused?: boolean; behindOnFees?: boolean; oftenAbsent?: boolean; sibling?: boolean; joinedMonthsAgo?: number };

// Name, year of birth, months since joining: the batches take them in this order.
const KARATE_ROLL: [string, number, number][] = [
  ["Vivaan Kulkarni", 2014, 7], ["Diya Pawar", 2015, 6], ["Reyansh Jadhav", 2013, 6], ["Myra Gokhale", 2016, 5], ["Kabir Naik", 2014, 4], ["Saanvi Bhosale", 2015, 4],
  ["Arjun Salunkhe", 2012, 3], ["Tara Chavan", 2016, 3], ["Advik More", 2013, 2], ["Ira Kamble", 2017, 1], ["Yash Gaikwad", 2014, 0],
  ["Rudra Sawant", 2012, 5], ["Navya Deshpande", 2013, 3], ["Om Thorat", 2014, 2],
  ["Pranav Kale", 2011, 4], ["Siya Raut", 2012, 2], ["Atharv Wagh", 2011, 0],
];
const karateRoll = (consents: NewStudentInput["consents"]): DemoStudent[] => [
  ...KARATE_ROLL.map(([fullName, year, joinedMonthsAgo], i): DemoStudent => ({ fullName, dateOfBirth: `${year}-0${1 + (i % 9)}-15`, gender: i % 2 ? "female" : "male", guardian: { fullName: `Parent of ${fullName.split(" ")[0]}`, phone: `98765002${String(i).padStart(2, "0")}`, relation: "father" }, programInterest: "Beginners", consents, joinedMonthsAgo })),
  { fullName: "Neel Phadke", dateOfBirth: "2015-12-02", gender: "male", guardian: { fullName: "Sunil Phadke", phone: "9876500299", relation: "father" }, programInterest: "Beginners", consents, joinedMonthsAgo: 0 },
  // The split family: her mother (the default payer) pays Teens Morning, her father pays Advanced A.
  { fullName: "Riya Mehta", dateOfBirth: "2012-04-18", gender: "female", guardian: { fullName: "Anjali Mehta", phone: "9876500298", relation: "mother" }, programInterest: "Beginners", consents, joinedMonthsAgo: 5 },
];
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
    ...(vertical === "karate" ? karateRoll(consents) : []),
  ];
}

type DemoBatch = { name: string; program: string; plan: string; coach: "owner" | "coach"; inExtraBranch?: boolean; withRoom?: boolean; capacity: number | null; startDate: string; slots: { weekday: number; startTime: string; endTime: string }[]; students: string[]; payer?: { student: string; guardian: { fullName: string; phone: string; relation: "father" } }; sellPack?: string };
const MEHTA_FATHER = { fullName: "Rohit Mehta", phone: "9876500297", relation: "father" as const };
const days = (weekdays: number[], startTime: string, endTime: string) => weekdays.map((weekday) => ({ weekday, startTime, endTime }));

// Early Morning (5:30 AM) is there for Prompt 9's timezone test.
function demoBatches(vertical: string, today: string): { programs: string[]; plans: PlanInput[]; batches: DemoBatch[] } {
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
    // Eight months of history; the grace is set so this month's open invoices fall due tomorrow.
    const first = `${today.slice(0, 7)}-01`;
    const startDate = addMonths(first, -7);
    const graceDays = Math.round((Date.parse(addDays(today, 1)) - Date.parse(first)) / 86_400_000);
    const roll = KARATE_ROLL.map(([name]) => name);
    const base = { program: "Karate", plan: "Karate Monthly", startDate };
    return {
      programs: ["Karate"],
      plans: [
        { name: "Karate Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "80000", admissionFeePaise: "50000", graceDays },
        { name: "Karate Advanced", kind: "recurring", billingCycle: "monthly", amountPaise: "100000", graceDays },
      ],
      batches: [
        // 14 of 15 seats: the near-capacity case.
        { ...base, name: "Beginners B", coach: "coach", withRoom: true, capacity: 15, slots: days([1, 3, 5], "18:00", "19:00"), students: ["Aarav Deshmukh", "Anaya Deshmukh", "Ishaan Patil", "Rohan Joshi", ...roll.slice(0, 11)] },
        { ...base, plan: "Karate Advanced", name: "Advanced A", coach: "coach", withRoom: true, capacity: 20, slots: days([1, 3, 5], "19:15", "20:15"), students: ["Zoya Shaikh", "Riya Mehta"], payer: { student: "Riya Mehta", guardian: MEHTA_FATHER } },
        { ...base, name: "Early Morning", coach: "owner", capacity: 15, slots: days([2, 4], "05:30", "06:30"), students: ["Meher Kaur"] },
        // No capacity set: the bare-count case. Two mornings, so a day has classes already started.
        { ...base, name: "Junior Morning", coach: "owner", capacity: null, slots: days([1, 2, 3, 4, 5, 6], "06:30", "07:30"), students: roll.slice(11, 14) },
        { ...base, name: "Teens Morning", coach: "coach", withRoom: true, capacity: 20, slots: days([1, 2, 3, 4, 5, 6], "08:00", "09:00"), students: [...roll.slice(14), "Riya Mehta"] },
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
          { label: "4th installment", amountPaise: "400000", dueOffsetDays: 270 },
        ],
      },
      { name: "Doubt Pack", kind: "package", amountPaise: "300000", sessions: 10, validDays: 60 },
    ],
    batches: [
      { name: "Maths 9 A", program: "Class 9 Maths", plan: "Maths Monthly", coach: "coach", withRoom: true, capacity: 25, startDate: "2026-07-01", slots: [...days([1, 3], "16:00", "17:00"), ...days([6], "10:00", "11:30")], students: ["Aarav Deshmukh", "Zoya Shaikh", "Ishaan Patil", "Rohan Joshi"] },
      { name: "Science 10", program: "Class 10 Science", plan: "Science Term", coach: "coach", inExtraBranch: true, capacity: 20, startDate: "2026-07-01", slots: days([2, 4], "17:00", "18:30"), students: ["Zoya Shaikh", "Meher Kaur"] },
      { name: "Doubt Clearing", program: "Class 9 Maths", plan: "Doubt Pack", coach: "coach", capacity: 10, startDate: "2026-07-01", slots: days([2, 5], "15:00", "16:00"), students: ["Anaya Deshmukh"], sellPack: "Anaya Deshmukh" },
    ],
  };
}

// The last 30 days of classes, marked mostly present with a few absences and
// late arrivals, so Today, the register and profiles have something to show.
// Of today's started classes the latest is left unmarked, so Today has a gap.
async function seedHistory(tx: Tx, ctx: StudentCtx, oftenAbsent: Set<string>, timeZone: string): Promise<void> {
  const now = new Date();
  const today = todayIn(timeZone, now);
  await reconcileSessions(tx, { now: new Date(now.getTime() - 30 * 86_400_000) });
  await reconcileSessions(tx, { now });
  const past = await tx.select().from(sessions).where(and(lt(sessions.startsAt, now), ne(sessions.status, "cancelled"))).orderBy(asc(sessions.startsAt));
  const startedToday = past.filter((c) => c.sessionDate === today);
  const unmarked = startedToday.length > 1 ? startedToday.at(-1)?.id : undefined;
  for (const [day, c] of past.entries()) {
    if (c.id === unmarked) continue;
    const at = new Date(Math.min(c.startsAt.getTime() + 3_600_000, now.getTime()));
    const roster = await classRoster(tx, ctx, c.id, { now: at });
    const marks = roster.entries
      .filter((e) => !e.paused)
      .map((e, i) => ({ studentId: e.studentId, status: (oftenAbsent.has(e.studentId) ? day % 5 < 3 : (i + day) % 9 === 0) ? ("absent" as const) : (i + day) % 13 === 0 ? ("late" as const) : ("present" as const) }));
    if (marks.length) await saveAttendance(tx, ctx, c.id, { marks }, { now: at });
  }
}

// A sibling discount, then eight months of invoices (this month's included),
// each made and issued on the 1st as the monthly run would.
async function seedFees(tx: Tx, ctx: StudentCtx, siblingId: string, timeZone: string): Promise<void> {
  const sibling = await createDiscount(tx, ctx, { name: "Sibling 10%", kind: "percent", value: 10 });
  await createDiscount(tx, ctx, { name: "Scholarship", kind: "percent", value: 100 });
  await giveDiscount(tx, ctx, siblingId, { discountId: sibling.id, reason: "Second child in the family", validFrom: "2026-06-01" });
  const thisMonth = `${todayIn(timeZone).slice(0, 7)}-01`;
  for (const first of Array.from({ length: 8 }, (_, i) => addMonths(thisMonth, i - 7))) {
    const now = new Date(`${first}T04:00:00Z`);
    await generateInvoices(tx, { actorType: "system", tenantId: ctx.tenantId }, { now });
    await issueInvoices(tx, ctx, "all", { now }).catch((e: unknown) => {
      if (!(e instanceof ConflictError)) throw e; // nothing to issue that month
    });
  }
}

// Earlier months paid on varying days, some in part and a few not at all, and
// the family behind on fees only for the oldest months; this month's came in
// over the days, two today (cash, UPI in part), the rest still open. Their
// receipts wait under Messages → To send.
async function seedPayments(tx: Tx, ctx: StudentCtx, behind: Set<string>, timeZone: string, studentIds: Map<string, string>): Promise<void> {
  const today = todayIn(timeZone);
  const thisMonth = `${today.slice(0, 7)}-01`;
  const recent = addMonths(thisMonth, -2);
  // Meher's term plan is paid by hand in seedDeskCases, two installments of four.
  const meher = studentIds.get("Meher Kaur");
  const open = (await tx.select().from(invoices).where(inArray(invoices.status, ["issued", "part_paid"])).orderBy(asc(invoices.dueDate), asc(invoices.number))).filter((i) => (!(i.payerGuardianId && behind.has(i.payerGuardianId)) || i.issueDate < recent) && !(meher && i.studentId === meher));
  const pay = (inv: Invoice, on: string, method: "cash" | "upi" | "cheque", half = false) => {
    const balance = inv.totalPaise - inv.paidPaise;
    const amount = String(half ? (split(balance, 2)[0] ?? balance) : balance);
    const reference = { cash: "", upi: `UPI 4471 ${on.slice(5).replace("-", "")}`, cheque: "000451" }[method];
    const input = { requestId: uuidv7(), memberId: inv.studentId ?? "", branchId: inv.branchId, amountPaise: amount, method, ...(reference ? { reference } : {}), allocations: [{ invoiceId: inv.id, amountPaise: amount }] };
    return recordPayment(tx, ctx, input, on < today ? { now: new Date(`${on}T05:30:00Z`) } : {});
  };
  const methods = ["cash", "upi", "cheque"] as const;
  for (const [i, inv] of open.filter((x) => x.issueDate < thisMonth).entries()) {
    if (i % 13 === 12) continue; // a late payer, still owing
    await pay(inv, addDays(inv.issueDate, 1 + ((i * 7) % 24)), methods[i % 3] ?? "cash", i % 6 === 5);
  }
  const [first, second, third, ...rest] = open.filter((x) => x.issueDate >= thisMonth);
  const fourth = addDays(thisMonth, 3);
  if (first) await pay(first, fourth < today ? fourth : today, "cheque");
  if (second) await pay(second, today, "cash");
  if (third) await pay(third, today, "upi", true);
  // Every other one of the rest came in early; the others fall due tomorrow.
  for (const [j, inv] of rest.entries()) {
    const on = addDays(thisMonth, 1 + (j % 5));
    if (j % 2 === 0) await pay(inv, on < today ? on : today, methods[j % 3] ?? "cash");
  }
}

// Cases for the Finance pages (Bright Future): a uniform paid at the desk by card and part refunded,
// a term plan with two of four installments paid, a family part paid past due and holding advance.
async function seedDeskCases(tx: Tx, ctx: StudentCtx, studentIds: Map<string, string>, timeZone: string): Promise<void> {
  const today = todayIn(timeZone);
  const id = (name: string) => studentIds.get(name) ?? "";
  const [aarav] = await tx.select().from(invoices).where(eq(invoices.studentId, id("Aarav Deshmukh"))).limit(1);
  const branchId = aarav?.branchId ?? "";
  const uniform = await recordPayment(tx, ctx, { requestId: uuidv7(), memberId: id("Aarav Deshmukh"), branchId, amountPaise: "85000", method: "card", reference: "Card 4821", charge: { kind: "item", description: "Uniform", amountPaise: "85000" } });
  await refundPayment(tx, ctx, uniform.id, { amountPaise: "20000", method: "cash", reason: "Wrong size, one item returned" });
  const meherInvoices = await tx.select().from(invoices).where(eq(invoices.studentId, id("Meher Kaur"))).orderBy(asc(invoices.dueDate));
  for (const inv of meherInvoices.slice(0, 2)) {
    const amount = String(inv.totalPaise - inv.paidPaise);
    const on = addDays(inv.dueDate, -2);
    await recordPayment(tx, ctx, { requestId: uuidv7(), memberId: inv.studentId ?? "", branchId: inv.branchId, amountPaise: amount, method: "upi", reference: `UPI 3390 ${on.slice(5)}`, allocations: [{ invoiceId: inv.id, amountPaise: amount }] }, on < today ? { now: new Date(`${on}T05:30:00Z`) } : {});
  }
  // Ishaan's family: the oldest overdue invoice half paid, the next paid with 500 over, so advance is held while more is owed.
  const owing = await tx.select().from(invoices).where(and(eq(invoices.studentId, id("Ishaan Patil")), inArray(invoices.status, ["issued", "part_paid"]))).orderBy(asc(invoices.dueDate));
  const [older, next] = owing.filter((i) => i.dueDate < today);
  if (older) {
    const half = String((older.totalPaise - older.paidPaise) / 2n);
    await recordPayment(tx, ctx, { requestId: uuidv7(), memberId: id("Ishaan Patil"), branchId: older.branchId, amountPaise: half, method: "cash", allocations: [{ invoiceId: older.id, amountPaise: half }] });
  }
  if (next) {
    const balance = next.totalPaise - next.paidPaise;
    await recordPayment(tx, ctx, { requestId: uuidv7(), memberId: id("Ishaan Patil"), branchId: next.branchId, amountPaise: String(balance + 50000n), method: "upi", reference: "UPI 6612", allocations: [{ invoiceId: next.id, amountPaise: String(balance) }] });
  }
}

// Five enquiries along the funnel: two new (one due today), one called, one
// with a trial booked, one lost; so the board, Follow-ups and Report show.
async function seedEnquiries(tx: Tx, ctx: StudentCtx, programId: string, timeZone: string): Promise<void> {
  const today = todayIn(timeZone);
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

  for (const { resource, coach, extraBranch, extraModule, alsoCoach, autoIssue, ...input } of DEMO_TENANTS) {
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
      const roleId = (name: string) => roles.find((r) => r.name === name)?.id ?? ""; // demo data only
      const staff = await createStaffMember(tx, ctx, { email: coach.email, fullName: coach.name, roleId: roleId("Teacher") });
      await setPassword(tx, ctx, staff.id, DEMO_PASSWORD);
      // Bright Future's Sana teaches here too, with the same password: the staff academy switcher's demo.
      if (alsoCoach) await setPassword(tx, ctx, (await createStaffMember(tx, ctx, { email: alsoCoach.email, fullName: alsoCoach.name, roleId: roleId("Teacher") })).id, DEMO_PASSWORD);
      // A front desk hire who hasn't opened their invite yet.
      const desk = await addStaff(tx, ctx, { email: `desk@${input.slug}.demo`, fullName: "Neha Kulkarni", roleId: roleId("Front Desk") });
      invite = `http://${input.slug}.localhost:3000/invite/${desk.token}`;

      const sctx: StudentCtx = { ...ctx, branchIds: [] };
      const guardianOf = new Map<string, string>(); // guardian phone -> guardian id
      const studentIds = new Map<string, string>();
      const toPause: string[] = [];
      let siblingId = "";
      const behind = new Set<string>(); // payer guardian ids
      const oftenAbsent = new Set<string>(); // student ids
      const joinedOn = new Map<string, string>(); // student name -> join date, also their enrolment start
      const thisMonth = `${todayIn(tenant.timezone).slice(0, 7)}-01`;
      for (const { paused, behindOnFees, oftenAbsent: absent, sibling, joinedMonthsAgo, ...student } of demoStudents(input.verticalPreset ?? "general")) {
        // Karate's original six joined when the history starts; the rest on their own month.
        const months = joinedMonthsAgo ?? (input.verticalPreset === "karate" ? 7 : undefined);
        if (months !== undefined) joinedOn.set(student.fullName, addMonths(thisMonth, -months));
        const phone = student.guardian?.phone ?? student.adultPhone ?? "";
        const linkGuardianId = guardianOf.get(phone);
        const joined = joinedOn.get(student.fullName);
        const created = await createStudent(tx, sctx, { ...student, ...(linkGuardianId ? { linkGuardianId } : {}), ...(joined ? { joinedOn: joined } : {}) });
        guardianOf.set(phone, created.guardian.id);
        studentIds.set(student.fullName, created.student.id);
        if (paused) toPause.push(created.student.id);
        if (sibling) siblingId = created.student.id;
        if (behindOnFees) behind.add(created.guardian.id);
        if (absent) oftenAbsent.add(created.student.id);
      }

      const plan = demoBatches(input.verticalPreset ?? "general", todayIn(tenant.timezone));
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
        for (const name of b.students) {
          const e = await enroll(tx, sctx, { studentId: studentIds.get(name) ?? "", batchId: batch.id, startDate: joinedOn.get(name) ?? b.startDate });
          // A session pack sold at the desk before the 30 days of marks begin, so they count against it.
          if (b.sellPack === name) await recordPayment(tx, sctx, { requestId: uuidv7(), memberId: e.studentId, branchId: batch.branchId, amountPaise: "300000", method: "upi", reference: "UPI 5520", pack: { enrollmentId: e.id } }, { now: new Date(Date.now() - 31 * 86_400_000) });
          if (b.payer?.student !== name) continue;
          // An override: this enrollment is paid by a second guardian, who also gets access to the member.
          const other = await createGuardian(tx, { tenantId: tenant.id, fullName: b.payer.guardian.fullName, phone: b.payer.guardian.phone });
          await linkGuardian(tx, tenant.id, e.studentId, other.id, b.payer.guardian.relation);
          await updateEnrollment(tx, e.id, { payerGuardianId: other.id });
        }
      }
      // Paused after joining, so their batches show as paused too.
      for (const id of toPause) await setStudentStatus(tx, sctx, id, { status: "paused" });
      await seedHistory(tx, sctx, oftenAbsent, tenant.timezone);
      for (const h of DEMO_HOLIDAYS) await addHoliday(tx, sctx, h);
      await seedFees(tx, sctx, siblingId, tenant.timezone);
      await seedPayments(tx, sctx, behind, tenant.timezone, studentIds);
      if (input.slug === "bright-future") await seedDeskCases(tx, sctx, studentIds, tenant.timezone);
      if (autoIssue) await saveFeeSettings(tx, sctx, { invoiceIssue: "auto" });
      await queueReminders(tx); // what the hourly job would queue now
      await seedEnquiries(tx, sctx, programIds.values().next().value ?? "", tenant.timezone);
    });
    // A second module waits for its first payment; started after the programs,
    // since with two modules on each new program names its module.
    if (extraModule) await withPlatformAdmin({ action: "seed.module", actorType: "system", tenantId: tenant.id }, (tx) => startActivity(tx, { tenantId: tenant.id, branchId: branch.id, activityKey: extraModule, today: todayIn(tenant.timezone), trial: false }));
    console.log(`seed: ${input.slug} owner ${owner.email} / coach ${coach.email}, password ${DEMO_PASSWORD} (dev only); ${demoStudents(input.verticalPreset ?? "general").length} students, ${demoBatches(input.verticalPreset ?? "general", todayIn(tenant.timezone)).batches.length} batches, up to eight months of invoices, payments spread over them`);
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
