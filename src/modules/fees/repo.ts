import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, type SQL, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import { batches, programs } from "@/modules/batches/schema";
import { type Enrollment, enrollments } from "@/modules/enrollments/schema";
import { staffUsers } from "@/modules/staff/schema";
import { households, students } from "@/modules/students/schema";
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

export type Billable = { e: Enrollment; plan: FeePlan; studentName: string; householdId: string; branchId: string; batchName: string; programId: string; programName: string };

// Enrollments with a plan that reach [from, to].
export async function billableEnrollments(tx: Tx, opts: { from: string; to: string; ids?: string[] }): Promise<Billable[]> {
  return tx
    .select({ e: enrollments, plan: feePlans, studentName: students.fullName, householdId: students.householdId, branchId: students.branchId, batchName: batches.name, programId: batches.programId, programName: programs.name })
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

// The family's open draft for a billing day, locked so issuing can't race an append.
export async function familyDraft(tx: Tx, householdId: string, branchId: string, issueDate: string): Promise<Invoice | undefined> {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.householdId, householdId), eq(invoices.branchId, branchId), eq(invoices.issueDate, issueDate), eq(invoices.status, "draft"), isNull(invoices.studentId)))
    .limit(1)
    .for("update");
  return inv;
}

export async function insertLines(tx: Tx, rows: Omit<typeof invoiceLines.$inferInsert, "id">[]): Promise<void> {
  if (rows.length) await tx.insert(invoiceLines).values(rows.map((r) => ({ id: uuidv7(), ...r })));
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

// Unpaid invoices holding a charge for after an enrollment's last day.
export async function invoicesAfterEnd(tx: Tx, enrollmentIds: string[]): Promise<{ invoice: Invoice; studentName: string; batchName: string; moved: boolean; lastDay: string }[]> {
  if (!enrollmentIds.length) return [];
  const rows = await tx
    .selectDistinctOn([invoices.id], { invoice: invoices, studentName: students.fullName, batchName: batches.name, status: enrollments.status, lastDay: enrollments.endDate })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(enrollments, eq(enrollments.id, invoiceLines.enrollmentId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .where(and(inArray(invoiceLines.enrollmentId, enrollmentIds), isNotNull(enrollments.endDate), gt(invoiceLines.periodStart, enrollments.endDate), inArray(invoices.status, ["draft", "issued"]), eq(invoices.paidPaise, 0n)))
    .orderBy(invoices.id);
  return rows.map((r) => ({ invoice: r.invoice, studentName: r.studentName, batchName: r.batchName, moved: r.status === "transferred", lastDay: r.lastDay ?? "" }));
}

export const INVOICE_VIEWS = ["draft", "unpaid", "overdue", "month", "void"] as const;
export type InvoiceView = (typeof INVOICE_VIEWS)[number];
export type InvoiceRow = Invoice & { householdName: string; students: string[] };

// Overdue is worked out when reading (due date passed), never stored.
const OWED = ["issued", "part_paid"] as const;

function viewFilter(view: InvoiceView, today: string): SQL | undefined {
  switch (view) {
    case "draft":
      return eq(invoices.status, "draft");
    case "unpaid":
      return inArray(invoices.status, [...OWED]);
    case "overdue":
      return and(inArray(invoices.status, [...OWED]), lt(invoices.dueDate, today));
    case "month":
      return and(inArray(invoices.status, [...OWED, "paid"]), gte(invoices.issueDate, `${today.slice(0, 7)}-01`), lte(invoices.issueDate, today));
    case "void":
      return eq(invoices.status, "void");
  }
}

export async function listInvoices(tx: Tx, branchIds: string[], opts: { view?: InvoiceView; today: string; studentId?: string; limit?: number }): Promise<InvoiceRow[]> {
  const forStudent = opts.studentId ? sql`EXISTS (SELECT 1 FROM app.invoice_lines l WHERE l.invoice_id = ${invoices.id} AND l.student_id = ${opts.studentId})` : undefined;
  const rows = await tx
    .select({ inv: invoices, householdName: households.name })
    .from(invoices)
    .innerJoin(households, eq(households.id, invoices.householdId))
    .where(and(invoiceScope(branchIds), opts.view ? viewFilter(opts.view, opts.today) : undefined, forStudent))
    .orderBy(...(opts.view === "draft" ? [asc(invoices.issueDate), asc(households.name)] : [desc(invoices.issueDate), desc(invoices.number), desc(invoices.id)]))
    .limit(opts.limit ?? 200);
  const names = new Map<string, Set<string>>();
  for (const l of await linesOf(tx, rows.map((r) => r.inv.id))) if (l.studentName) names.set(l.invoiceId, (names.get(l.invoiceId) ?? new Set()).add(l.studentName));
  return rows.map((r) => ({ ...r.inv, householdName: r.householdName, students: [...(names.get(r.inv.id) ?? [])] }));
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
