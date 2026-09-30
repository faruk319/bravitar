import { performance } from "node:perf_hooks";
import { and, asc, inArray, lt, ne } from "drizzle-orm";
import { sql as runtimeSql, type Tx } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, todayIn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { classRoster, saveAttendance } from "@/modules/attendance/service";
import { addProgram, createBatch } from "@/modules/batches/service";
import { createEnquiry, logActivity, markLost } from "@/modules/enquiries/service";
import { enroll } from "@/modules/enrollments/service";
import { generateInvoices } from "@/modules/fees/invoicing";
import { invoices } from "@/modules/fees/schema";
import { createPlan, issueInvoices } from "@/modules/fees/service";
import { recordPayment } from "@/modules/payments/service";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createStudent, type StudentCtx } from "@/modules/students/service";
import { testAcademy } from "@/lib/db/isolation/academy";
import { type Dashboard, dashboardData } from "./service";

// pnpm bench:dashboard (docs/06 Prompt 19): the dashboard under 2 s with 2,000
// students. Builds a throwaway academy through the services (30 days of marks,
// two months of invoices and payments, enquiries), times the dashboard, then
// deletes the academy. A local database only.

const STUDENTS = 2_000;
const BATCHES = 20;
const RUNS = 5;
const LIMIT_MS = 2_000;
const TZ = "Asia/Kolkata";

const started = performance.now();
const log = (what: string) => console.log(`bench: ${what} (${Math.round((performance.now() - started) / 1000)} s)`);

async function build(T: string, ownerId: string): Promise<void> {
  const as = async (tx: Tx): Promise<StudentCtx> => ({ ...(await loadAccessContext(tx, ownerId)), branchIds: [] });
  const today = todayIn(TZ);
  const start = addDays(today, -60);

  // Twenty batches of a hundred, three days a week, billed monthly.
  const batchIds = await withTenant(T, async (tx) => {
    const ctx = await as(tx);
    const program = await addProgram(tx, ctx, { name: "Karate" });
    const plan = await createPlan(tx, ctx, { name: "Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "80000" });
    const ids: string[] = [];
    for (let b = 0; b < BATCHES; b++) {
      const hour = String(6 + (b % 14)).padStart(2, "0");
      const slots = (b % 2 ? [2, 4, 6] : [1, 3, 5]).map((weekday) => ({ weekday, startTime: `${hour}:00`, endTime: `${hour}:45` }));
      ids.push((await createBatch(tx, ctx, { name: `Batch ${b + 1}`, programId: program.id, capacity: 150, defaultFeePlanId: plan.id, startDate: start, slots })).id);
    }
    await createEnquiryMix(tx, ctx, program.id, today);
    return ids;
  });

  // Every fourth child is the younger sibling of the one before; every 25th joined today.
  for (let from = 0; from < STUDENTS; from += 100) {
    await withTenant(T, async (tx) => {
      const ctx = await as(tx);
      let household = "";
      for (let i = from; i < from + 100; i++) {
        const head = i % 4 === 3 ? i - 1 : i;
        const joined = i % 25 === 24 ? today : start;
        const s = await createStudent(tx, ctx, {
          fullName: `Student ${i + 1}`,
          joinedOn: joined,
          guardian: { fullName: `Parent ${head + 1}`, phone: `98${String(10_000_000 + head).slice(-8)}`, relation: "mother" },
          ...(head !== i && household ? { householdId: household } : {}),
          consents: { dataProcessing: true, whatsapp: true },
        });
        household = s.household.id;
        await enroll(tx, ctx, { studentId: s.student.id, batchId: batchIds[i % BATCHES] ?? "", startDate: joined });
      }
    });
  }
  log(`${STUDENTS} students in ${BATCHES} batches`);

  // The last 30 days marked: mostly present, one child in fifty often away.
  await withTenant(T, async (tx) => {
    await reconcileSessions(tx, { now: new Date(Date.now() - 30 * 86_400_000) });
    await reconcileSessions(tx, {});
  });
  const past = await withTenant(T, (tx) => tx.select().from(sessions).where(and(lt(sessions.startsAt, new Date()), ne(sessions.status, "cancelled"))).orderBy(asc(sessions.startsAt)));
  let marks = 0;
  for (let from = 0; from < past.length; from += 20) {
    await withTenant(T, async (tx) => {
      const ctx = await as(tx);
      for (const [k, c] of past.slice(from, from + 20).entries()) {
        const day = from + k;
        const at = new Date(c.startsAt.getTime() + 3_600_000);
        const roster = await classRoster(tx, ctx, c.id, { now: at });
        const away = (i: number) => (i % 50 === 7 ? day % 5 < 3 : (i + day) % 9 === 0);
        const list = roster.entries.filter((e) => !e.paused).map((e, i) => ({ studentId: e.studentId, status: away(i) ? ("absent" as const) : (i + day) % 13 === 0 ? ("late" as const) : ("present" as const) }));
        if (list.length) await saveAttendance(tx, ctx, c.id, { marks: list }, { now: at });
        marks += list.length;
      }
    });
  }
  log(`${marks} marks in ${past.length} classes`);

  // Last month's and this month's invoices, issued on the 1st.
  const thisMonth = `${today.slice(0, 7)}-01`;
  for (const first of [`${addDays(thisMonth, -1).slice(0, 7)}-01`, thisMonth]) {
    const now = new Date(`${first}T04:00:00Z`);
    await withTenant(T, async (tx) => {
      await generateInvoices(tx, { actorType: "system", tenantId: T }, { now });
      await issueInvoices(tx, await as(tx), "all", { now });
    });
  }

  // Four families in five paid last month, half this month, over the days.
  const open = await withTenant(T, (tx) => tx.select().from(invoices).where(inArray(invoices.status, ["issued", "part_paid"])).orderBy(asc(invoices.issueDate), asc(invoices.number)));
  const paying = open.filter((inv, i) => (inv.issueDate < thisMonth ? i % 5 !== 0 : i % 2 === 0));
  const daysSoFar = Number(today.slice(8)) - 1;
  for (let from = 0; from < paying.length; from += 100) {
    await withTenant(T, async (tx) => {
      const ctx = await as(tx);
      for (const [k, inv] of paying.slice(from, from + 100).entries()) {
        const spread = 2 + ((from + k) % 26);
        const on = addDays(inv.issueDate, inv.issueDate < thisMonth ? spread : Math.min(spread, daysSoFar));
        const amount = String(inv.totalPaise - inv.paidPaise);
        await recordPayment(tx, ctx, { requestId: uuidv7(), householdId: inv.householdId, branchId: inv.branchId, amountPaise: amount, method: k % 3 ? "cash" : "upi", allocations: [{ invoiceId: inv.id, amountPaise: amount }] }, on < today ? { now: new Date(`${on}T05:30:00Z`) } : {});
      }
    });
  }
  log(`${open.length} invoices, ${paying.length} paid`);
}

// Two hundred enquiries: some due today, some called, some lost.
async function createEnquiryMix(tx: Tx, ctx: StudentCtx, programId: string, today: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const e = await createEnquiry(tx, ctx, { name: `Enquiry ${i + 1}`, phone: `97${String(10_000_000 + i).slice(-8)}`, programId, ...(i % 5 === 0 ? { nextFollowUp: today } : {}) });
    if (i % 3 === 0) await logActivity(tx, ctx, e.id, { kind: "call" });
    if (i % 7 === 0) await markLost(tx, ctx, e.id, { reason: "timing" });
  }
}

async function main(): Promise<void> {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) throw new Error("bench:dashboard runs against a local database only");
  const stamp = Date.now().toString(36);
  const t = await testAcademy({ name: `Bench ${stamp}`, slug: `bench-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `bench-${stamp}@example.test` } });
  try {
    await build(t.tenant.id, t.owner.id);
    const owner = await withTenant(t.tenant.id, async (tx) => ({ ...(await loadAccessContext(tx, t.owner.id)), branchIds: await staffBranchIds(tx, t.owner.id) }));
    const times: number[] = [];
    let d: Dashboard | undefined;
    for (let run = 0; run <= RUNS; run++) {
      const t0 = performance.now();
      d = await withTenant(t.tenant.id, (tx) => dashboardData(tx, owner));
      if (run) times.push(performance.now() - t0); // the first run warms up
    }
    // So every block had real work to do.
    log(`${d?.today?.held} classes today, ${d?.money?.thisMonth?.count} receipts this month, ${d?.money?.owed?.invoices} invoices owed, at risk ${d?.atRisk?.attendance} + ${d?.atRisk?.unpaid}, ${d?.pipeline?.followUps} follow-ups due`);
    const sorted = times.sort((a, b) => a - b);
    const [median, slowest] = [Math.round(sorted[Math.floor(RUNS / 2)] ?? 0), Math.round(sorted.at(-1) ?? 0)];
    log(`dashboard ${median} ms median, ${slowest} ms slowest of ${RUNS} (limit ${LIMIT_MS} ms): ${slowest < LIMIT_MS ? "OK" : "TOO SLOW, add the nightly rollup"}`);
    if (slowest >= LIMIT_MS) process.exitCode = 1;
  } finally {
    await deleteTenantsCompletely([t.tenant.id]);
    log("throwaway academy deleted");
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await runtimeSql.end({ timeout: 5 });
    await platformSql.end({ timeout: 5 });
  });
