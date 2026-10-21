import { and, asc, desc, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, like, lt, lte, ne, or, type SQL, sql } from "drizzle-orm";
import { addDays } from "@/lib/dates";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import type { Paise } from "@/lib/money/paise";
import { batches, programs } from "@/modules/batches/schema";
import { type Enrollment, enrollments } from "@/modules/enrollments/schema";
import { staffUsers } from "@/modules/staff/schema";
import { type Payer, payerKey, payerOf } from "@/modules/students/payer";
import { guardians, students } from "@/modules/students/schema";
import { type DisplayStatus, displayStatus, installmentOf } from "./billing";
import type { InvoiceQuery, InvoiceSort } from "./invoice-query";
import { type Discount, discounts, type FeePlan, feePlans, type Invoice, type InvoiceLine, invoiceLines, invoices, type StudentDiscount, studentDiscounts } from "./schema";

// ---- fee plans

export async function insertPlan(tx: Tx, row: Omit<typeof feePlans.$inferInsert, "id">): Promise<FeePlan> {
  const [p] = await tx.insert(feePlans).values({ id: uuidv7(), ...row }).returning();
  if (!p) throw new Error("fee plan insert returned no row");
  return p;
}

export async function getPlan(tx: Tx, id: string): Promise<FeePlan | undefined> {
  const [p] = await tx.select().from(feePlans).where(and(eq(feePlans.id, id), isNull(feePlans.deletedAt)));
  return p;
}

export async function updatePlan(tx: Tx, id: string, patch: Partial<typeof feePlans.$inferInsert>): Promise<FeePlan> {
  const [p] = await tx.update(feePlans).set(patch).where(eq(feePlans.id, id)).returning();
  if (!p) throw new Error("fee plan update matched no row");
  return p;
}

export type PlanRow = FeePlan & { programName: string | null; students: number };

// students = enrollments still on the plan (active or paused).
export async function listPlans(tx: Tx): Promise<PlanRow[]> {
  const [rows, usage] = await Promise.all([
    tx
      .select({ p: feePlans, programName: programs.name })
      .from(feePlans)
      .leftJoin(programs, eq(programs.id, feePlans.programId))
      .where(isNull(feePlans.deletedAt))
      .orderBy(desc(feePlans.isActive), asc(feePlans.name)),
    tx
      .select({ planId: enrollments.feePlanId, n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(and(isNotNull(enrollments.feePlanId), inArray(enrollments.status, ["active", "paused"])))
      .groupBy(enrollments.feePlanId),
  ]);
  const n = new Map(usage.map((u) => [u.planId, u.n]));
  return rows.map((r) => ({ ...r.p, programName: r.programName, students: n.get(r.p.id) ?? 0 }));
}

// ---- discounts

export async function insertDiscount(tx: Tx, row: Omit<typeof discounts.$inferInsert, "id">): Promise<Discount> {
  const [d] = await tx.insert(discounts).values({ id: uuidv7(), ...row }).returning();
  if (!d) throw new Error("discount insert returned no row");
  return d;
}

export async function getDiscount(tx: Tx, id: string): Promise<Discount | undefined> {
  const [d] = await tx.select().from(discounts).where(eq(discounts.id, id));
  return d;
}

export async function updateDiscount(tx: Tx, id: string, patch: Partial<typeof discounts.$inferInsert>): Promise<Discount> {
  const [d] = await tx.update(discounts).set(patch).where(eq(discounts.id, id)).returning();
  if (!d) throw new Error("discount update matched no row");
  return d;
}

export async function listDiscounts(tx: Tx): Promise<Discount[]> {
  return tx.select().from(discounts).orderBy(desc(discounts.isActive), asc(discounts.name));
}

export async function insertStudentDiscount(tx: Tx, row: Omit<typeof studentDiscounts.$inferInsert, "id">): Promise<StudentDiscount> {
  const [d] = await tx.insert(studentDiscounts).values({ id: uuidv7(), ...row }).returning();
  if (!d) throw new Error("student discount insert returned no row");
  return d;
}

export async function getStudentDiscount(tx: Tx, id: string): Promise<StudentDiscount | undefined> {
  const [d] = await tx.select().from(studentDiscounts).where(eq(studentDiscounts.id, id));
  return d;
}

export async function updateStudentDiscount(tx: Tx, id: string, patch: Partial<typeof studentDiscounts.$inferInsert>): Promise<StudentDiscount> {
  const [d] = await tx.update(studentDiscounts).set(patch).where(eq(studentDiscounts.id, id)).returning();
  if (!d) throw new Error("student discount update matched no row");
  return d;
}

export type GivenDiscount = StudentDiscount & Pick<Discount, "name" | "kind" | "value"> & { approvedByName: string | null };

export async function discountsOf(tx: Tx, studentIds: string[]): Promise<GivenDiscount[]> {
  if (!studentIds.length) return [];
  const rows = await tx
    .select({ g: studentDiscounts, name: discounts.name, kind: discounts.kind, value: discounts.value, approvedByName: staffUsers.fullName })
    .from(studentDiscounts)
    .innerJoin(discounts, eq(discounts.id, studentDiscounts.discountId))
    .leftJoin(staffUsers, eq(staffUsers.id, studentDiscounts.approvedBy))
    .where(inArray(studentDiscounts.studentId, studentIds))
    .orderBy(desc(studentDiscounts.validFrom), desc(studentDiscounts.createdAt));
  return rows.map((r) => ({ ...r.g, name: r.name, kind: r.kind, value: r.value, approvedByName: r.approvedByName }));
}

// ---- billing inputs

export type Billable = { e: Enrollment; plan: FeePlan; studentName: string; branchId: string; batchName: string; programId: string; programName: string };

// Enrollments with a plan that reach [from, to].
export async function billableEnrollments(tx: Tx, opts: { from: string; to: string; ids?: string[] }): Promise<Billable[]> {
  return tx
    .select({ e: enrollments, plan: feePlans, studentName: students.fullName, branchId: students.branchId, batchName: batches.name, programId: batches.programId, programName: programs.name })
    .from(enrollments)
    .innerJoin(feePlans, eq(feePlans.id, enrollments.feePlanId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .where(
      and(
        isNull(students.deletedAt),
        isNull(feePlans.deletedAt),
        lte(enrollments.startDate, opts.to),
        sql`(${enrollments.endDate} IS NULL OR ${enrollments.endDate} >= GREATEST(${enrollments.startDate}, ${opts.from}::date))`,
        opts.ids ? inArray(enrollments.id, opts.ids) : undefined,
      ),
    );
}

export type Link = { id: string; studentId: string; programId: string; startDate: string; createdAt: Date; next: string | null; planKind: FeePlan["kind"] | null };

// Every enrollment of these students, for move chains and "first in program".
export async function enrollmentLinks(tx: Tx, studentIds: string[]): Promise<Link[]> {
  if (!studentIds.length) return [];
  return tx
    .select({ id: enrollments.id, studentId: enrollments.studentId, programId: batches.programId, startDate: enrollments.startDate, createdAt: enrollments.createdAt, next: enrollments.transferredToEnrollmentId, planKind: feePlans.kind })
    .from(enrollments)
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .leftJoin(feePlans, eq(feePlans.id, enrollments.feePlanId))
    .where(inArray(enrollments.studentId, studentIds));
}

// ---- invoices

// Generation, issue and void take turns per academy.
export async function lockInvoicing(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoicing:${tenantId}`}))`);
}

export async function takenKeys(tx: Tx, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await tx.select({ key: invoiceLines.billingKey }).from(invoiceLines).where(inArray(invoiceLines.billingKey, keys));
  return new Set(rows.map((r) => r.key ?? ""));
}

export async function insertInvoice(tx: Tx, row: Omit<typeof invoices.$inferInsert, "id">): Promise<Invoice> {
  const [inv] = await tx.insert(invoices).values({ id: uuidv7(), ...row }).returning();
  if (!inv) throw new Error("invoice insert returned no row");
  return inv;
}

export async function updateInvoice(tx: Tx, id: string, patch: Partial<typeof invoices.$inferInsert>): Promise<Invoice> {
  const [inv] = await tx.update(invoices).set(patch).where(eq(invoices.id, id)).returning();
  if (!inv) throw new Error("invoice update matched no row");
  return inv;
}

// branchIds empty = all branches.
const invoiceScope = (branchIds: string[]): SQL | undefined => (branchIds.length ? inArray(invoices.branchId, branchIds) : undefined);

export async function getInvoice(tx: Tx, branchIds: string[], id: string): Promise<Invoice | undefined> {
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), invoiceScope(branchIds)));
  return inv;
}

export const payerIs = (p: Payer): SQL =>
  p.kind === "guardian" ? sql`${invoices.payerGuardianId} = ${p.guardianId} AND ${invoices.payerMemberId} IS NULL` : sql`${invoices.payerMemberId} = ${p.memberId} AND ${invoices.payerGuardianId} IS NULL`;

// Payers' names today by payerKey, two queries for any number (deleted guardians keep theirs), for stamping on invoices.
export async function payerNames(tx: Tx, payers: Payer[]): Promise<Map<string, string>> {
  const gIds = [...new Set(payers.flatMap((p) => (p.kind === "guardian" ? [p.guardianId] : [])))];
  const mIds = [...new Set(payers.flatMap((p) => (p.kind === "member" ? [p.memberId] : [])))];
  const [gs, ms] = await Promise.all([
    gIds.length ? tx.select({ id: guardians.id, name: guardians.fullName }).from(guardians).where(inArray(guardians.id, gIds)) : [],
    mIds.length ? tx.select({ id: students.id, name: students.fullName }).from(students).where(inArray(students.id, mIds)) : [],
  ]);
  return new Map([...gs.map((g) => [payerKey({ kind: "guardian", guardianId: g.id }), g.name] as const), ...ms.map((m) => [payerKey({ kind: "member", memberId: m.id }), m.name] as const)]);
}

// The member's open tuition draft for a billing day and payer, locked so issuing can't race an append.
// Installment drafts and charges added by hand (a line with no billing key) stand alone.
export async function memberDraft(tx: Tx, studentId: string, branchId: string, issueDate: string, payer: Payer): Promise<Invoice | undefined> {
  const alone = sql`EXISTS (SELECT 1 FROM app.invoice_lines l WHERE l.invoice_id = ${invoices.id} AND (l.billing_key LIKE 'installment|%' OR l.billing_key IS NULL))`;
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.studentId, studentId), eq(invoices.branchId, branchId), eq(invoices.issueDate, issueDate), eq(invoices.status, "draft"), sql`NOT ${alone}`, payerIs(payer)))
    .limit(1)
    .for("update");
  return inv;
}

export async function insertLines(tx: Tx, rows: Omit<typeof invoiceLines.$inferInsert, "id">[]): Promise<void> {
  if (rows.length) await tx.insert(invoiceLines).values(rows.map((r) => ({ id: uuidv7(), ...r })));
}

// A draft's lines swapped for new ones; nothing is numbered or paid on a draft yet.
export async function replaceLines(tx: Tx, invoiceId: string, rows: Omit<typeof invoiceLines.$inferInsert, "id">[]): Promise<void> {
  await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  await insertLines(tx, rows);
}

// Programs whose admission fee a plan already billed this student, with the invoice's number (null while it is a draft). Cancelled invoices don't count.
export async function admissionBilled(tx: Tx, studentId: string): Promise<{ programId: string; number: string | null }[]> {
  const rows = await tx
    .select({ key: invoiceLines.billingKey, number: invoices.number })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(like(invoiceLines.billingKey, `admission|${studentId}|%`), ne(invoices.status, "void")));
  return rows.flatMap((r) => {
    const programId = r.key?.split("|")[2];
    return programId ? [{ programId, number: r.number }] : [];
  });
}

export type LineRow = InvoiceLine & { studentName: string | null };

export async function linesOf(tx: Tx, invoiceIds: string[]): Promise<LineRow[]> {
  if (!invoiceIds.length) return [];
  const rows = await tx
    .select({ l: invoiceLines, studentName: students.fullName })
    .from(invoiceLines)
    .leftJoin(students, eq(students.id, invoiceLines.studentId))
    .where(inArray(invoiceLines.invoiceId, invoiceIds))
    .orderBy(asc(students.fullName), asc(invoiceLines.periodStart), asc(sql`${invoiceLines.kind} = 'admission'`), asc(invoiceLines.id));
  return rows.map((r) => ({ ...r.l, studentName: r.studentName }));
}

// The charges on it may be billed again.
export async function clearKeys(tx: Tx, invoiceId: string): Promise<void> {
  await tx.update(invoiceLines).set({ billingKey: null }).where(eq(invoiceLines.invoiceId, invoiceId));
}

// Invoices billing a recurring plan for after an enrollment's last day, paid or
// not. Installments are never voided here (docs/03 §6).
export async function invoicesAfterEnd(tx: Tx, enrollmentIds: string[]): Promise<{ invoice: Invoice; studentName: string; batchName: string; moved: boolean; lastDay: string }[]> {
  if (!enrollmentIds.length) return [];
  const rows = await tx
    .selectDistinctOn([invoices.id], { invoice: invoices, studentName: students.fullName, batchName: batches.name, status: enrollments.status, lastDay: enrollments.endDate })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(feePlans, eq(feePlans.id, invoiceLines.feePlanId))
    .innerJoin(enrollments, eq(enrollments.id, invoiceLines.enrollmentId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .where(
      and(
        inArray(invoiceLines.enrollmentId, enrollmentIds),
        eq(feePlans.kind, "recurring"),
        isNotNull(enrollments.endDate),
        gt(invoiceLines.periodStart, enrollments.endDate),
        inArray(invoices.status, ["draft", "issued", "part_paid", "paid"]),
      ),
    )
    .orderBy(invoices.id);
  return rows.map((r) => ({ invoice: r.invoice, studentName: r.studentName, batchName: r.batchName, moved: r.status === "transferred", lastDay: r.lastDay ?? "" }));
}

export type OpenInstallment = Pick<Invoice, "number" | "status" | "dueDate" | "totalPaise" | "paidPaise"> & { invoiceId: string; enrollmentId: string | null; description: string };

// A student's term and one-time installments not yet paid in full, soonest first.
export async function openInstallments(tx: Tx, branchIds: string[], studentId: string): Promise<OpenInstallment[]> {
  return tx
    .select({
      invoiceId: invoices.id,
      number: invoices.number,
      status: invoices.status,
      dueDate: invoices.dueDate,
      totalPaise: invoices.totalPaise,
      paidPaise: invoices.paidPaise,
      enrollmentId: invoiceLines.enrollmentId,
      description: invoiceLines.description,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(feePlans, eq(feePlans.id, invoiceLines.feePlanId))
    .where(and(eq(invoiceLines.studentId, studentId), eq(invoiceLines.kind, "tuition"), ne(feePlans.kind, "recurring"), inArray(invoices.status, ["draft", "issued", "part_paid"]), invoiceScope(branchIds)))
    .orderBy(asc(invoices.dueDate), asc(invoices.id));
}

// The earliest due date among what the student still owes (issued or part paid); null when nothing is owed.
export async function nextDueDate(tx: Tx, branchIds: string[], studentId: string): Promise<string | null> {
  const [row] = await tx
    .select({ due: sql<string | null>`min(${invoices.dueDate})` })
    .from(invoices)
    .where(and(eq(invoices.studentId, studentId), inArray(invoices.status, ["issued", "part_paid", "overdue"]), invoiceScope(branchIds)));
  return row?.due ?? null;
}

// A draft that never got a name cannot be issued; it lists blank.
const billToName = sql<string>`coalesce(${invoices.billToName}, '')`;

export type InvoiceRow = Omit<Invoice, "billToName"> & {
  billToName: string;
  students: string[];
  display: DisplayStatus;
  programs: string[]; // by name, through the lines' enrollments and batches
  installment: { n: number; of: number } | null; // "2 of 4", for a term plan's installment
};

// Overdue is worked out when reading (due date passed), never stored.
const OWED = ["issued", "part_paid"] as const;

// Unpaid invoices falling due between two dates, for the reminder job.
export async function owedDueBetween(tx: Tx, from: string, to: string): Promise<Invoice[]> {
  return tx
    .select()
    .from(invoices)
    .where(and(inArray(invoices.status, [...OWED]), gte(invoices.dueDate, from), lte(invoices.dueDate, to)))
    .orderBy(asc(invoices.dueDate), asc(invoices.id));
}

// displayStatus() as SQL, for the tabs and their counts; a test keeps the two agreeing.
const displaySql = (today: string): SQL<DisplayStatus> => sql<DisplayStatus>`CASE
  WHEN ${invoices.status} = 'draft' THEN 'draft'
  WHEN ${invoices.status} = 'void' THEN 'cancelled'
  WHEN ${invoices.status} = 'paid' THEN 'paid'
  WHEN ${invoices.status} = 'overdue' OR ${invoices.dueDate} < ${today}::date THEN 'overdue'
  WHEN ${invoices.status} = 'part_paid' THEN 'part_paid'
  ELSE 'due' END`;

// `status` narrows to a tab (or Open); everything else is what the tab counts are worked out under.
export type InvoiceFilter = Partial<Pick<InvoiceQuery, "status" | "q" | "programId" | "batchId" | "issuedFrom" | "issuedTo" | "dueFrom" | "dueTo">> & { today: string; studentId?: string };

// % _ and \ in what was typed are characters, not wildcards.
export const likeOf = (typed: string) => `%${typed.replace(/[\\%_]/g, "\\$&")}%`;

function filterWhere(tx: Tx, branchIds: string[], f: InvoiceFilter): SQL | undefined {
  const where = [invoiceScope(branchIds)];
  if (f.studentId) where.push(exists(tx.select({ one: sql`1` }).from(invoiceLines).where(and(eq(invoiceLines.invoiceId, invoices.id), eq(invoiceLines.studentId, f.studentId)))));
  if (f.issuedFrom) where.push(gte(invoices.issueDate, f.issuedFrom));
  if (f.issuedTo) where.push(lte(invoices.issueDate, f.issuedTo));
  if (f.dueFrom) where.push(gte(invoices.dueDate, f.dueFrom));
  if (f.dueTo) where.push(lte(invoices.dueDate, f.dueTo));
  if (f.programId || f.batchId) {
    // One line must be in both the program and the batch asked for.
    const on = [eq(invoiceLines.invoiceId, invoices.id)];
    if (f.programId) on.push(eq(batches.programId, f.programId));
    if (f.batchId) on.push(eq(batches.id, f.batchId));
    where.push(exists(tx.select({ one: sql`1` }).from(invoiceLines).innerJoin(enrollments, eq(enrollments.id, invoiceLines.enrollmentId)).innerJoin(batches, eq(batches.id, enrollments.batchId)).where(and(...on))));
  }
  const q = f.q?.trim();
  if (q) {
    const pattern = likeOf(q);
    const student = exists(tx.select({ one: sql`1` }).from(students).where(and(eq(students.id, invoices.studentId), ilike(students.fullName, pattern))));
    where.push(or(ilike(invoices.number, pattern), ilike(invoices.billToName, pattern), student));
  }
  return and(...where);
}

function statusWhere(status: InvoiceFilter["status"], today: string): SQL | undefined {
  if (!status || status === "all") return undefined;
  return status === "open" ? sql`${displaySql(today)} IN ('due', 'part_paid', 'overdue')` : sql`${displaySql(today)} = ${status}`;
}

// How many invoices each tab holds under these filters; the tab itself is not one of them, so the tabs add up to All.
export async function invoiceCounts(tx: Tx, branchIds: string[], f: Omit<InvoiceFilter, "status">): Promise<Record<DisplayStatus | "all", number>> {
  const display = displaySql(f.today);
  const n = (s: DisplayStatus) => sql<number>`count(*) FILTER (WHERE ${display} = ${s})::int`;
  const [r] = await tx
    .select({ all: sql<number>`count(*)::int`, draft: n("draft"), due: n("due"), part_paid: n("part_paid"), overdue: n("overdue"), paid: n("paid"), cancelled: n("cancelled") })
    .from(invoices)
    .where(filterWhere(tx, branchIds, f));
  return { all: r?.all ?? 0, draft: r?.draft ?? 0, due: r?.due ?? 0, part_paid: r?.part_paid ?? 0, overdue: r?.overdue ?? 0, paid: r?.paid ?? 0, cancelled: r?.cancelled ?? 0 };
}

const ORDER: Record<InvoiceSort, SQL[]> = {
  newest: [desc(invoices.issueDate), desc(invoices.number), desc(invoices.id)],
  oldest: [asc(invoices.issueDate), asc(invoices.number), asc(invoices.id)],
  amount: [desc(invoices.totalPaise), desc(invoices.issueDate), desc(invoices.id)],
  due: [asc(invoices.dueDate), asc(invoices.issueDate), asc(invoices.id)],
};

// Program names by invoice, first by name.
export async function programsOf(tx: Tx, invoiceIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!invoiceIds.length) return out;
  const rows = await tx
    .selectDistinct({ invoiceId: invoiceLines.invoiceId, name: programs.name })
    .from(invoiceLines)
    .innerJoin(enrollments, eq(enrollments.id, invoiceLines.enrollmentId))
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .where(inArray(invoiceLines.invoiceId, invoiceIds))
    .orderBy(asc(programs.name));
  for (const r of rows) out.set(r.invoiceId, [...(out.get(r.invoiceId) ?? []), r.name]);
  return out;
}

export type InvoiceProgram = { enrollmentId: string; programName: string; batchName: string; planName: string | null };

// The placements an invoice bills, once each, with the fee plan on their lines.
export async function programsOnInvoice(tx: Tx, invoiceId: string): Promise<InvoiceProgram[]> {
  const rows = await tx
    .selectDistinct({ enrollmentId: enrollments.id, programName: programs.name, batchName: batches.name, planName: feePlans.name })
    .from(invoiceLines)
    .innerJoin(enrollments, eq(enrollments.id, invoiceLines.enrollmentId))
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .leftJoin(feePlans, eq(feePlans.id, invoiceLines.feePlanId))
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(programs.name), asc(batches.name), asc(feePlans.name), asc(enrollments.id));
  // Lines on two plans list the placement once, under the first plan by name.
  const once = new Map<string, InvoiceProgram>();
  for (const r of rows) if (!once.has(r.enrollmentId)) once.set(r.enrollmentId, r);
  return [...once.values()];
}

// "2 of 4" for the installment invoices among these lines: the position from the key, the size from every key of that series.
async function installmentsOf(tx: Tx, lines: Pick<LineRow, "invoiceId" | "billingKey">[]): Promise<Map<string, { n: number; of: number }>> {
  const mine = new Map<string, NonNullable<ReturnType<typeof installmentOf>>>();
  for (const l of lines) {
    const i = installmentOf(l.billingKey);
    if (i && !mine.has(l.invoiceId)) mine.set(l.invoiceId, i);
  }
  const seqs = [...new Set([...mine.values()].map((i) => i.seq))];
  if (!seqs.length) return new Map();
  const keys = await tx.selectDistinct({ key: invoiceLines.billingKey }).from(invoiceLines).where(or(...seqs.map((seq) => like(invoiceLines.billingKey, `installment|${seq}|%`))));
  const series = new Map<string, { keys: number; last: number }>();
  for (const { key } of keys) {
    const i = installmentOf(key);
    if (!i) continue;
    const s = series.get(i.seq) ?? { keys: 0, last: -1 };
    series.set(i.seq, { keys: s.keys + 1, last: Math.max(s.last, i.index) });
  }
  return new Map([...mine].map(([invoiceId, i]) => [invoiceId, { n: i.index + 1, of: Math.max(series.get(i.seq)?.keys ?? 0, i.index + 1) }]));
}

export async function listInvoices(tx: Tx, branchIds: string[], opts: InvoiceFilter & { sort?: InvoiceSort; limit?: number; offset?: number }): Promise<InvoiceRow[]> {
  const rows = await tx
    .select({ inv: invoices, billToName })
    .from(invoices)
    .where(and(filterWhere(tx, branchIds, opts), statusWhere(opts.status, opts.today)))
    .orderBy(...ORDER[opts.sort ?? "newest"])
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0);
  const ids = rows.map((r) => r.inv.id);
  const [lines, programNames] = await Promise.all([linesOf(tx, ids), programsOf(tx, ids)]);
  const positions = await installmentsOf(tx, lines);
  const names = new Map<string, Set<string>>();
  for (const l of lines) if (l.studentName) names.set(l.invoiceId, (names.get(l.invoiceId) ?? new Set()).add(l.studentName));
  return rows.map((r) => ({
    ...r.inv,
    billToName: r.billToName,
    students: [...(names.get(r.inv.id) ?? [])],
    display: displayStatus(r.inv, opts.today),
    programs: programNames.get(r.inv.id) ?? [],
    installment: positions.get(r.inv.id) ?? null,
  }));
}

export async function draftSummary(tx: Tx, branchIds: string[]): Promise<{ count: number; total: bigint }> {
  const [r] = await tx
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${invoices.totalPaise}), 0)::text` })
    .from(invoices)
    .where(and(eq(invoices.status, "draft"), invoiceScope(branchIds)));
  return { count: r?.count ?? 0, total: BigInt(r?.total ?? "0") };
}

export async function studentsOnPlan(tx: Tx, planId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.feePlanId, planId), inArray(enrollments.status, ["active", "paused"])));
  return r?.n ?? 0;
}

export async function draftIds(tx: Tx, branchIds: string[]): Promise<string[]> {
  const rows = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.status, "draft"), invoiceScope(branchIds)))
    .orderBy(asc(invoices.issueDate), asc(invoices.createdAt), asc(invoices.id));
  return rows.map((r) => r.id);
}

export async function lockDrafts(tx: Tx, branchIds: string[], ids: string[]): Promise<Invoice[]> {
  if (!ids.length) return [];
  return tx
    .select()
    .from(invoices)
    .where(and(inArray(invoices.id, ids), eq(invoices.status, "draft"), invoiceScope(branchIds)))
    .orderBy(asc(invoices.issueDate), asc(invoices.createdAt), asc(invoices.id))
    .for("update");
}

export type PayerDues = { payerKey: string; name: string; invoices: number; notDue: bigint; days0to30: bigint; days31to60: bigint; over60: bigint };

// Outstanding dues aged by days past the due date (agreed 2026-09-25), one row per payer. An invoice with no payer is one "No payer" row.
export async function duesByPayer(tx: Tx, branchIds: string[], today: string): Promise<PayerDues[]> {
  const owed = sql`${invoices.totalPaise} - ${invoices.paidPaise}`;
  const late = sql`(${today}::date - ${invoices.dueDate})`;
  const bucket = (when: SQL) => sql<string>`coalesce(sum(${owed}) FILTER (WHERE ${when}), 0)::text`;
  const rows = await tx
    .select({
      payerGuardianId: invoices.payerGuardianId,
      payerMemberId: invoices.payerMemberId,
      invoices: sql<number>`count(*)::int`,
      notDue: bucket(sql`${late} < 0`),
      days0to30: bucket(sql`${late} BETWEEN 0 AND 30`),
      days31to60: bucket(sql`${late} BETWEEN 31 AND 60`),
      over60: bucket(sql`${late} > 60`),
      owed: sql<string>`sum(${owed})::text`,
    })
    .from(invoices)
    .where(and(inArray(invoices.status, [...OWED]), invoiceScope(branchIds)))
    .groupBy(invoices.payerGuardianId, invoices.payerMemberId);
  const payers = rows.flatMap((r) => payerOf(r) ?? []);
  const names = await payerNames(tx, payers);
  return rows
    .map(({ payerGuardianId, payerMemberId, owed: total, ...r }) => {
      const payer = payerOf({ payerGuardianId, payerMemberId });
      const key = payer ? payerKey(payer) : "none";
      return { total: BigInt(total), row: { ...r, payerKey: key, name: (payer && names.get(key)) || "No payer", notDue: BigInt(r.notDue), days0to30: BigInt(r.days0to30), days31to60: BigInt(r.days31to60), over60: BigInt(r.over60) } };
    })
    .sort((a, b) => (a.total === b.total ? a.row.name.localeCompare(b.row.name) : a.total > b.total ? -1 : 1))
    .map((x) => x.row);
}

// Payers with at least `min` invoices past their due date and not fully paid.
export async function payersOverdue(tx: Tx, branchIds: string[], today: string, min: number): Promise<{ payer: Payer; overdue: number; owedPaise: bigint }[]> {
  const rows = await tx
    .select({ payerGuardianId: invoices.payerGuardianId, payerMemberId: invoices.payerMemberId, overdue: sql<number>`count(*)::int`, owed: sql<string>`sum(${invoices.totalPaise} - ${invoices.paidPaise})::text` })
    .from(invoices)
    .where(and(inArray(invoices.status, [...OWED]), lt(invoices.dueDate, today), invoiceScope(branchIds)))
    .groupBy(invoices.payerGuardianId, invoices.payerMemberId)
    .having(sql`count(*) >= ${min}`);
  return rows.flatMap((r) => {
    const payer = payerOf(r);
    return payer ? [{ payer, overdue: r.overdue, owedPaise: BigInt(r.owed) }] : [];
  });
}

// What is owed now, how much of it and how many payers are past due, and how many invoices fall due tomorrow.
export async function owedSummary(tx: Tx, branchIds: string[], today: string): Promise<{ invoices: number; owedPaise: bigint; overduePayers: number; overduePaise: bigint; dueTomorrow: number }> {
  const tomorrow = addDays(today, 1);
  const [r] = await tx
    .select({
      invoices: sql<number>`count(*)::int`,
      owed: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}), 0)::text`,
      overduePayers: sql<number>`count(DISTINCT coalesce(${invoices.payerGuardianId}, ${invoices.payerMemberId})) FILTER (WHERE ${invoices.dueDate} < ${today})::int`,
      overdue: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}) FILTER (WHERE ${invoices.dueDate} < ${today}), 0)::text`,
      dueTomorrow: sql<number>`count(*) FILTER (WHERE ${invoices.dueDate} = ${tomorrow})::int`,
    })
    .from(invoices)
    .where(and(inArray(invoices.status, [...OWED]), invoiceScope(branchIds)));
  return {
    invoices: r?.invoices ?? 0,
    owedPaise: BigInt(r?.owed ?? "0"),
    overduePayers: r?.overduePayers ?? 0,
    overduePaise: BigInt(r?.overdue ?? "0"),
    dueTomorrow: r?.dueTomorrow ?? 0,
  };
}

// ---- student plans

export type StudentPlanTab = "active" | "paused" | "ended";
const TAB_STATUS: Record<StudentPlanTab, Enrollment["status"]> = { active: "active", paused: "paused", ended: "left" };
export type StudentPlanFilter = { q?: string | undefined; programId?: string | undefined; batchId?: string | undefined; planId?: string | undefined };
export type StudentPlanBase = { branchId: string; e: Enrollment; plan: FeePlan; studentName: string; studentCode: string; batchName: string; programName: string };

// Enrollments with a fee plan; a transferred one is not listed, its next enrollment is.
function planWhere(branchIds: string[], f: StudentPlanFilter): SQL | undefined {
  const where = [isNotNull(enrollments.feePlanId), isNull(students.deletedAt), branchIds.length ? inArray(students.branchId, branchIds) : undefined, ne(enrollments.status, "transferred")];
  if (f.programId) where.push(eq(batches.programId, f.programId));
  if (f.batchId) where.push(eq(batches.id, f.batchId));
  if (f.planId) where.push(eq(feePlans.id, f.planId));
  const q = f.q?.trim();
  if (q) where.push(or(ilike(students.fullName, likeOf(q)), ilike(students.code, likeOf(q))));
  return and(...where);
}

const planFrom = (tx: Tx) =>
  tx.select({ branchId: students.branchId, e: enrollments, plan: feePlans, studentName: students.fullName, studentCode: students.code, batchName: batches.name, programName: programs.name })
    .from(enrollments)
    .innerJoin(feePlans, eq(feePlans.id, enrollments.feePlanId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId));

export async function studentPlanRows(tx: Tx, branchIds: string[], f: StudentPlanFilter & { tab: StudentPlanTab; limit: number; offset: number }): Promise<StudentPlanBase[]> {
  return planFrom(tx)
    .where(and(planWhere(branchIds, f), eq(enrollments.status, TAB_STATUS[f.tab])))
    .orderBy(asc(students.fullName), asc(enrollments.startDate), asc(enrollments.id))
    .limit(f.limit)
    .offset(f.offset);
}

// What each tab holds under the filters; the tab itself is not one of them.
export async function studentPlanTabCounts(tx: Tx, branchIds: string[], f: StudentPlanFilter): Promise<Record<StudentPlanTab, number>> {
  const n = (status: Enrollment["status"]) => sql<number>`count(*) FILTER (WHERE ${enrollments.status} = ${status})::int`;
  const [r] = await tx
    .select({ active: n("active"), paused: n("paused"), ended: n("left") })
    .from(enrollments)
    .innerJoin(feePlans, eq(feePlans.id, enrollments.feePlanId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .where(planWhere(branchIds, f));
  return { active: r?.active ?? 0, paused: r?.paused ?? 0, ended: r?.ended ?? 0 };
}

// The earliest unpaid installment's due date per term enrollment.
export async function nextInstallmentDue(tx: Tx, enrollmentIds: string[]): Promise<Map<string, string>> {
  if (!enrollmentIds.length) return new Map();
  const rows = await tx
    .select({ enrollmentId: invoiceLines.enrollmentId, due: sql<string>`min(${invoices.dueDate})` })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(feePlans, eq(feePlans.id, invoiceLines.feePlanId))
    .where(and(inArray(invoiceLines.enrollmentId, enrollmentIds), eq(invoiceLines.kind, "tuition"), eq(feePlans.kind, "term"), inArray(invoices.status, ["draft", "issued", "part_paid"])))
    .groupBy(invoiceLines.enrollmentId);
  return new Map(rows.flatMap((r) => (r.enrollmentId ? [[r.enrollmentId, r.due] as const] : [])));
}

// One enrollment's placement, whatever its status (a transferred one too), if the branches reach its student.
// A student's placements on a fee plan that are still running (active or paused).
export async function studentPlansOf(tx: Tx, studentId: string): Promise<StudentPlanBase[]> {
  return planFrom(tx).where(and(eq(enrollments.studentId, studentId), inArray(enrollments.status, ["active", "paused"]))).orderBy(asc(enrollments.startDate), asc(enrollments.id));
}

export async function studentPlanRowOf(tx: Tx, branchIds: string[], enrollmentId: string): Promise<StudentPlanBase | undefined> {
  const [row] = await planFrom(tx).where(and(eq(enrollments.id, enrollmentId), isNull(students.deletedAt), branchIds.length ? inArray(students.branchId, branchIds) : undefined)).limit(1);
  return row;
}

export type BilledLine = { inv: Invoice; line: InvoiceLine; installment: { n: number; of: number } | null };

// Every line of the non-void invoices that carry this enrollment, oldest due first.
export async function billedLinesOf(tx: Tx, enrollmentId: string): Promise<BilledLine[]> {
  const rows = await tx
    .select({ inv: invoices, line: invoiceLines })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(ne(invoices.status, "void"), inArray(invoiceLines.invoiceId, tx.select({ id: invoiceLines.invoiceId }).from(invoiceLines).where(eq(invoiceLines.enrollmentId, enrollmentId)))))
    .orderBy(asc(invoices.dueDate), asc(invoices.issueDate), asc(invoices.createdAt), asc(invoiceLines.id));
  const position = await installmentsOf(tx, rows.map((r) => r.line));
  return rows.map((r) => ({ ...r, installment: position.get(r.inv.id) ?? null }));
}

export type OpenLine = { invoiceId: string; lineId: string; enrollmentId: string | null; weight: Paise; balance: Paise };

// Every line of each open invoice that carries one of these enrollments, with the invoice's balance.
export async function openInvoiceLines(tx: Tx, enrollmentIds: string[]): Promise<OpenLine[]> {
  if (!enrollmentIds.length) return [];
  const rows = await tx
    .select({ invoiceId: invoices.id, lineId: invoiceLines.id, enrollmentId: invoiceLines.enrollmentId, amount: invoiceLines.amountPaise, tax: invoiceLines.taxPaise, total: invoices.totalPaise, paid: invoices.paidPaise })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(inArray(invoices.status, ["issued", "part_paid"]), inArray(invoiceLines.invoiceId, tx.select({ id: invoiceLines.invoiceId }).from(invoiceLines).where(inArray(invoiceLines.enrollmentId, enrollmentIds)))));
  return rows.map((r) => ({ invoiceId: r.invoiceId, lineId: r.lineId, enrollmentId: r.enrollmentId, weight: r.amount + r.tax, balance: r.total - r.paid }));
}
