import { z } from "zod";
import { allows, assertCan, ForbiddenError } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, isIsoDate, todayIn } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { type Paise, roundHalfUp, sum } from "@/lib/money/paise";
import { getProgram, listBatchRows, listPrograms } from "@/modules/batches/repo";
import type { Program } from "@/modules/batches/schema";
import { currentEnrollmentsOf } from "@/modules/enrollments/repo";
import { allocateNumber, currentFy } from "@/modules/numbering/repo";
import { payerInScope } from "@/modules/payments/repo";
import { applyAdvance } from "@/modules/payments/service";
import { staffNames } from "@/modules/staff/repo";
import { type Payer, payerKey, payerOf, planPayer } from "@/modules/students/payer";
import { RELATION_LABELS } from "@/modules/students/relations";
import { guardiansOfMembers, leadGuardians } from "@/modules/students/repo";
import { requireStudent } from "@/modules/students/service";
import { getBranch, getOwnTenant, tenantToday, updateOwnTenant } from "@/modules/tenancy/repo";
import { type DisplayStatus, displayStatus, lineAmounts } from "./billing";
import { type ManualLine, manualLine } from "./charge";
import type { InvoiceQuery } from "./invoice-query";
import { type Actor, defaultPayerFor, type GenerateResult, generateInvoices, retotal, voidAndRebill } from "./invoicing";
import {
  admissionBilled,
  discountsOf,
  draftIds,
  draftSummary,
  type GivenDiscount,
  getDiscount,
  getInvoice,
  getPlan,
  getStudentDiscount,
  type InvoiceProgram,
  insertDiscount,
  insertInvoice,
  insertLines,
  insertPlan,
  insertStudentDiscount,
  invoiceCounts,
  type InvoiceRow,
  type LineRow,
  listDiscounts,
  listInvoices,
  listPlans,
  linesOf,
  lockDrafts,
  lockInvoicing,
  payerNames,
  type OpenInstallment,
  nextDueDate,
  openInstallments,
  type PlanRow,
  programsOnInvoice,
  replaceLines,
  studentsOnPlan,
  updateDiscount,
  updateInvoice,
  updatePlan,
  updateStudentDiscount,
} from "./repo";
import { type Discount, type FeePlan, type Invoice, PLAN_KINDS } from "./schema";

const actor = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });
const isoDate = z.string().refine(isIsoDate, "Pick a date");
// Paise arrive as a digit string (JSON has no bigint).
const paise = z
  .string()
  .regex(/^\d{1,13}$/, "Enter an amount")
  .transform((s) => BigInt(s));

const isUuid = (v: string) => z.uuid().safeParse(v).success;

async function timeZone(tx: Tx): Promise<string> {
  return (await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata";
}

// ---- fee plans (docs/04 "Fee plan types")

export const planSchema = z.object({
  name: z.string().trim().min(1, "Name the plan").max(80),
  programId: z.uuid().nullable().optional(),
  kind: z.enum(PLAN_KINDS),
  billingCycle: z.enum(["monthly", "quarterly", "half_yearly", "yearly"]).optional(),
  amountPaise: paise.optional(),
  admissionFeePaise: paise.optional(),
  billingDay: z.number().int().min(1).max(28).optional(),
  graceDays: z.number().int().min(0).max(90).optional(),
  taxRateBp: z.number().int().min(0).max(10_000).optional(),
  installments: z.array(z.object({ label: z.string().trim().min(1, "Name each installment").max(40), amountPaise: paise, dueOffsetDays: z.number().int().min(0).max(1000) })).max(12).optional(),
});
export type PlanInput = z.input<typeof planSchema>;

function planColumns(data: z.infer<typeof planSchema>) {
  const base = { name: data.name, programId: data.programId ?? null, kind: data.kind, admissionFeePaise: data.admissionFeePaise ?? 0n, billingDay: data.billingDay ?? 1, graceDays: data.graceDays ?? 7, taxRateBp: data.taxRateBp ?? 0 };
  if (data.kind === "term") {
    const parts = data.installments ?? [];
    if (!parts.length) throw new BadRequestError("Add an installment");
    if (parts.some((p) => p.amountPaise === 0n)) throw new BadRequestError("Each installment needs an amount");
    if (parts.some((p, i) => i > 0 && p.dueOffsetDays <= (parts[i - 1]?.dueOffsetDays ?? 0))) throw new BadRequestError("Each installment must fall due after the one before");
    const installments = parts.map((p) => ({ label: p.label, amount_paise: Number(p.amountPaise), due_offset_days: p.dueOffsetDays }));
    return { ...base, billingCycle: "one_time" as const, amountPaise: sum(parts.map((p) => p.amountPaise)), metadata: { installments } };
  }
  if (!data.amountPaise) throw new BadRequestError("Enter the fee");
  if (data.kind !== "recurring") return { ...base, billingCycle: "one_time" as const, amountPaise: data.amountPaise, metadata: {} };
  if (!data.billingCycle) throw new BadRequestError("Pick how often");
  return { ...base, billingCycle: data.billingCycle, amountPaise: data.amountPaise, metadata: {} };
}

const planAudit = (p: FeePlan) => ({ name: p.name, kind: p.kind, billingCycle: p.billingCycle, amountPaise: String(p.amountPaise), admissionFeePaise: String(p.admissionFeePaise), taxRateBp: p.taxRateBp, isActive: p.isActive });

async function checkProgram(tx: Tx, programId: string | null | undefined): Promise<void> {
  if (programId && !(await getProgram(tx, programId))) throw new NotFoundError("Program");
}

async function savePlan(fn: () => Promise<FeePlan>, name: string): Promise<FeePlan> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`A plan called "${name}" already exists`);
    throw e;
  }
}

export async function createPlan(tx: Tx, ctx: ScopedCtx, input: PlanInput): Promise<FeePlan> {
  assertCan(ctx, "fee_plans:manage");
  const data = planSchema.parse(input);
  await checkProgram(tx, data.programId);
  const plan = await savePlan(() => insertPlan(tx, { tenantId: ctx.tenantId, ...planColumns(data) }), data.name);
  await writeAudit(tx, { ...actor(ctx), action: "fee_plan.create", entityType: "fee_plan", entityId: plan.id, after: planAudit(plan) });
  return plan;
}

async function requirePlan(tx: Tx, id: string): Promise<FeePlan> {
  const plan = await getPlan(tx, id);
  if (!plan) throw new NotFoundError("Fee plan");
  return plan;
}

// New amounts apply from the next charge; what's billed stays.
export async function editPlan(tx: Tx, ctx: ScopedCtx, id: string, input: PlanInput): Promise<FeePlan> {
  assertCan(ctx, "fee_plans:manage");
  const before = await requirePlan(tx, id);
  const data = planSchema.parse(input);
  await checkProgram(tx, data.programId);
  if (data.kind !== before.kind && (await studentsOnPlan(tx, id))) throw new ConflictError("Students are on this plan, so its type can't change. Make a new plan instead.");
  const after = await savePlan(() => updatePlan(tx, id, planColumns(data)), data.name);
  await writeAudit(tx, { ...actor(ctx), action: "fee_plan.update", entityType: "fee_plan", entityId: id, before: planAudit(before), after: planAudit(after) });
  return after;
}

// Archived plans can't be picked; students already on one keep it.
export async function setPlanActive(tx: Tx, ctx: ScopedCtx, id: string, isActive: boolean): Promise<FeePlan> {
  assertCan(ctx, "fee_plans:manage");
  await requirePlan(tx, id);
  const after = await updatePlan(tx, id, { isActive });
  await writeAudit(tx, { ...actor(ctx), action: isActive ? "fee_plan.restore" : "fee_plan.archive", entityType: "fee_plan", entityId: id });
  return after;
}

export async function feeSetup(tx: Tx, ctx: ScopedCtx): Promise<{ plans: PlanRow[]; discounts: Discount[]; programs: Program[] }> {
  assertCan(ctx, "fee_plans:manage");
  const [plans, discounts, programs] = await Promise.all([listPlans(tx), listDiscounts(tx), listPrograms(tx, { activeOnly: true })]);
  return { plans, discounts, programs };
}

export type PlanChoice = Pick<FeePlan, "id" | "name" | "kind" | "billingCycle" | "amountPaise">;

// Active plans for the batch form and a student's plan picker.
export async function planChoices(tx: Tx, ctx: ScopedCtx): Promise<PlanChoice[]> {
  if (!ctx.modules.fees) return [];
  if (!(["fee_plans:manage", "batches:manage", "enrollments:manage"] as const).some((k) => allows(ctx, k))) throw new ForbiddenError("Not allowed: fee plans");
  return (await listPlans(tx)).filter((p) => p.isActive).map(({ id, name, kind, billingCycle, amountPaise }) => ({ id, name, kind, billingCycle, amountPaise }));
}

// ---- discounts (docs/04 "Discounts and waivers")

export const discountSchema = z.object({
  name: z.string().trim().min(1, "Name the discount").max(60),
  kind: z.enum(["percent", "amount"]),
  value: z.number().int().min(1, "Enter a value").max(1_000_000_000), // percent, or paise
});

export async function createDiscount(tx: Tx, ctx: ScopedCtx, input: z.input<typeof discountSchema>): Promise<Discount> {
  assertCan(ctx, "fee_plans:manage");
  const data = discountSchema.parse(input);
  if (data.kind === "percent" && data.value > 100) throw new BadRequestError("A percentage can't be over 100");
  const d = await insertDiscount(tx, { tenantId: ctx.tenantId, ...data });
  await writeAudit(tx, { ...actor(ctx), action: "discount.create", entityType: "discount", entityId: d.id, after: data });
  return d;
}

export async function setDiscountActive(tx: Tx, ctx: ScopedCtx, id: string, isActive: boolean): Promise<Discount> {
  assertCan(ctx, "fee_plans:manage");
  if (!(await getDiscount(tx, id))) throw new NotFoundError("Discount");
  const after = await updateDiscount(tx, id, { isActive });
  await writeAudit(tx, { ...actor(ctx), action: isActive ? "discount.restore" : "discount.archive", entityType: "discount", entityId: id });
  return after;
}

export async function discountChoices(tx: Tx, ctx: ScopedCtx): Promise<Discount[]> {
  assertCan(ctx, "invoices:manage");
  return (await listDiscounts(tx)).filter((d) => d.isActive);
}

export const giveDiscountSchema = z.object({
  discountId: z.uuid(),
  reason: z.string().trim().min(2, "Add a reason").max(200),
  validFrom: isoDate.optional(),
  validTo: isoDate.nullable().optional(),
});

// Always with a reason; shows on each invoice as its own line.
export async function giveDiscount(tx: Tx, ctx: ScopedCtx, studentId: string, input: z.input<typeof giveDiscountSchema>): Promise<GivenDiscount> {
  assertCan(ctx, "invoices:manage");
  await requireStudent(tx, ctx, studentId);
  const data = giveDiscountSchema.parse(input);
  const d = await getDiscount(tx, data.discountId);
  if (!d?.isActive) throw new NotFoundError("Discount");
  const validFrom = data.validFrom ?? (await tenantToday(tx));
  if (data.validTo && data.validTo < validFrom) throw new BadRequestError("The end date is before the start");
  const g = await insertStudentDiscount(tx, { tenantId: ctx.tenantId, studentId, discountId: d.id, reason: data.reason, validFrom, validTo: data.validTo ?? null, approvedBy: ctx.staffId });
  await writeAudit(tx, { ...actor(ctx), action: "discount.give", entityType: "student_discount", entityId: g.id, after: { studentId, discount: d.name, reason: g.reason, validFrom, validTo: g.validTo } });
  return { ...g, name: d.name, kind: d.kind, value: d.value, approvedByName: null };
}

// Stops from today; one that hasn't started never applies.
export async function endDiscount(tx: Tx, ctx: ScopedCtx, id: string): Promise<void> {
  assertCan(ctx, "invoices:manage");
  const g = await getStudentDiscount(tx, id);
  if (!g) throw new NotFoundError("Discount");
  await requireStudent(tx, ctx, g.studentId);
  const today = await tenantToday(tx);
  if (g.validTo && g.validTo < today) throw new ConflictError("Already ended");
  const validTo = addDays(g.validFrom > today ? g.validFrom : today, -1);
  await updateStudentDiscount(tx, id, { validTo });
  await writeAudit(tx, { ...actor(ctx), action: "discount.end", entityType: "student_discount", entityId: id, before: { validTo: g.validTo }, after: { validTo } });
}

// ---- invoices

const PAGE_SIZE = 10;

export type InvoiceList = {
  today: string;
  rows: InvoiceRow[];
  matched: number; // under the tab and filters asked for
  page: number;
  pageSize: number;
  counts: Record<DisplayStatus | "all", number>; // per tab, under the filters but not the tab
  drafts: { count: number; total: Paise }; // all that wait for review, whatever the filters
  applied: Omit<InvoiceQuery, "page">;
  options: { programs: { id: string; name: string }[]; batches: { id: string; name: string }[] };
};

export async function invoiceList(tx: Tx, ctx: ScopedCtx, q: InvoiceQuery, opts: { now?: Date } = {}): Promise<InvoiceList> {
  assertCan(ctx, "invoices:read");
  const today = todayIn(await timeZone(tx), opts.now);
  const { page: asked, ...applied } = q;
  const filter = { ...applied, today };
  const [counts, drafts, programs, batches] = await Promise.all([
    invoiceCounts(tx, ctx.branchIds, filter),
    draftSummary(tx, ctx.branchIds),
    listPrograms(tx),
    listBatchRows(tx, ctx.branchIds, { includeEnded: true }),
  ]);
  const matched = q.status === "all" ? counts.all : q.status === "open" ? counts.due + counts.part_paid + counts.overdue : counts[q.status];
  // A page past the end (a stale link) shows the last one.
  const page = Math.min(asked, Math.max(1, Math.ceil(matched / PAGE_SIZE)));
  const rows = await listInvoices(tx, ctx.branchIds, { ...filter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return {
    today,
    rows,
    matched,
    page,
    pageSize: PAGE_SIZE,
    counts,
    drafts,
    applied,
    options: { programs: programs.map((p) => ({ id: p.id, name: p.name })), batches: batches.map((b) => ({ id: b.id, name: b.name })) },
  };
}

async function requireInvoice(tx: Tx, ctx: ScopedCtx, id: string): Promise<Invoice> {
  const inv = await getInvoice(tx, ctx.branchIds, id);
  if (!inv) throw new NotFoundError("Invoice");
  return inv;
}

export type InvoiceView = {
  invoice: Invoice;
  display: DisplayStatus;
  overdue: boolean;
  billToName: string;
  lines: LineRow[];
  academy: { name: string; gstin: string | null; branch: string; address: string | null };
};

// Staff also see which placements it bills and who made it; the family's link does not.
export type InvoiceDetail = InvoiceView & { programs: InvoiceProgram[]; createdByName: string | null; issuedByName: string | null };

// A charge added by hand has no billing key on any line; only a draft of that kind can be edited.
export const handmade = (lines: Pick<LineRow, "billingKey">[]) => lines.length > 0 && lines.every((l) => l.billingKey === null);

export async function invoiceDetail(tx: Tx, ctx: ScopedCtx, id: string, opts: { now?: Date } = {}): Promise<InvoiceDetail> {
  assertCan(ctx, "invoices:read");
  const invoice = await requireInvoice(tx, ctx, id);
  const people = [invoice.createdBy, invoice.issuedBy].flatMap((staffId) => (staffId ? [staffId] : []));
  const [view, programs, names] = await Promise.all([invoiceView(tx, invoice, opts), programsOnInvoice(tx, id), staffNames(tx, people)]);
  const nameOf = (staffId: string | null) => (staffId ? (names.get(staffId) ?? null) : null);
  return { ...view, programs, createdByName: nameOf(invoice.createdBy), issuedByName: nameOf(invoice.issuedBy) };
}

// What staff and the family's private link both show; callers check access.
export async function invoiceView(tx: Tx, invoice: Invoice, opts: { now?: Date } = {}): Promise<InvoiceView> {
  const id = invoice.id;
  const [lines, tenant, branch] = await Promise.all([linesOf(tx, [id]), getOwnTenant(tx), getBranch(tx, invoice.branchId)]);
  const display = displayStatus(invoice, todayIn(tenant?.timezone ?? "Asia/Kolkata", opts.now));
  return {
    invoice,
    display,
    overdue: display === "overdue",
    billToName: invoice.billToName ?? "",
    lines,
    academy: { name: tenant?.name ?? "", gstin: tenant?.gstin ?? null, branch: branch?.name ?? "", address: branch?.address ?? null },
  };
}

export async function generateNow(tx: Tx, ctx: ScopedCtx, opts: { now?: Date } = {}): Promise<GenerateResult> {
  assertCan(ctx, "invoices:manage");
  return generateInvoices(tx, actor(ctx), opts.now ? { now: opts.now } : {});
}

// A row with both payer columns set is corrupt: keep the stored name instead of guessing whose it is.
function payerIfValid(inv: Invoice): Payer[] {
  try {
    const p = payerOf(inv);
    return p ? [p] : [];
  } catch {
    return [];
  }
}

const currentPayerName = (names: Map<string, string>, inv: Invoice) => payerIfValid(inv).map((p) => names.get(payerKey(p)))[0];

export const issueSchema = z.union([z.literal("all"), z.array(z.uuid()).min(1).max(1000)]);

// Draft → issued takes the next number in this transaction (docs/04), oldest first.
export async function issueInvoices(tx: Tx, ctx: ScopedCtx, input: z.input<typeof issueSchema>, opts: { now?: Date } = {}): Promise<Invoice[]> {
  assertCan(ctx, "invoices:manage");
  const ids = issueSchema.parse(input);
  await lockInvoicing(tx, ctx.tenantId);
  const drafts = await lockDrafts(tx, ctx.branchIds, ids === "all" ? await draftIds(tx, ctx.branchIds) : ids);
  if (!drafts.length) throw new ConflictError("Nothing to issue");
  return issueDrafts(tx, actor(ctx), drafts, { now: opts.now ?? new Date() });
}

// The issue loop, for callers that hold lockInvoicing and the drafts. Unless told otherwise, a payer's
// advance then pays what was just issued to that payer, oldest first (docs/03 §9).
export async function issueDrafts(tx: Tx, by: Actor, drafts: Invoice[], opts: { now: Date; applyAdvance?: boolean }): Promise<Invoice[]> {
  const today = todayIn(await timeZone(tx), opts.now);
  const fy = await currentFy(tx, opts.now);
  const issued: Invoice[] = [];
  const names = await payerNames(tx, drafts.flatMap((d) => payerIfValid(d)));
  for (const d of drafts) {
    // The bill-to name is frozen here (the payer's name today, else the one the draft carries); a draft with no name stays a draft.
    const billToName = currentPayerName(names, d) ?? d.billToName;
    if (!billToName) continue;
    const number = await allocateNumber(tx, by.tenantId, "invoice", fy);
    // Nothing to pay (a full waiver) is paid on issue.
    const inv = await updateInvoice(tx, d.id, { billToName, number, fy, status: d.totalPaise === 0n ? "paid" : "issued", issueDate: today, dueDate: d.dueDate > today ? d.dueDate : today, issuedAt: opts.now, issuedBy: by.actorType === "staff" ? (by.actorId ?? null) : null });
    await writeAudit(tx, { ...by, action: "invoice.issue", entityType: "invoice", entityId: d.id, after: { number, totalPaise: String(inv.totalPaise), billToName } });
    issued.push(inv);
  }
  if (opts.applyAdvance ?? true) {
    const payers = new Map(issued.flatMap((i) => payerIfValid(i).map((p) => [`${payerKey(p)}|${i.branchId}`, { payer: p, branchId: i.branchId }] as const)));
    for (const x of payers.values()) await applyAdvance(tx, by, x.payer, x.branchId);
  }
  return issued;
}

// ---- one-off charges (finance spec, "Create invoice")

export const manualInvoiceSchema = z.object({
  studentId: z.uuid(),
  payerGuardianId: z.uuid().optional(),
  payerMemberId: z.uuid().optional(),
  dueDate: isoDate.optional(),
  lines: z.array(manualLine).min(1, "Add a charge").max(20),
  issue: z.boolean().default(false),
});
const editSchema = manualInvoiceSchema.omit({ issue: true });

const payerColumns = (p: Payer) => ({ payerGuardianId: p.kind === "guardian" ? p.guardianId : null, payerMemberId: p.kind === "member" ? p.memberId : null });

// No billing key: the nightly run neither bills these again nor adds to their invoice. Tax only with a GSTIN.
function chargeRows(tenantId: string, invoiceId: string, studentId: string, lines: ManualLine[], gst: boolean) {
  return lines.map((l) => {
    const a = lineAmounts(l.amountPaise, 1, [], gst ? (l.taxRateBp ?? 0) : 0);
    return { tenantId, invoiceId, studentId, enrollmentId: l.enrollmentId ?? null, kind: l.kind, description: l.description, unitPaise: l.amountPaise, discountPaise: a.discount, taxPaise: a.tax, amountPaise: a.net, billingKey: null };
  });
}

const auditLines = (lines: { kind: string; description: string; amountPaise: Paise }[]) => lines.map((l) => ({ kind: l.kind, description: l.description, amountPaise: String(l.amountPaise) }));

// The payer asked for (it must be one of the student's), else the one the lines' programs agree on, else the student's default.
async function payerOfCharge(tx: Tx, data: Pick<z.output<typeof manualInvoiceSchema>, "studentId" | "payerGuardianId" | "payerMemberId" | "lines">): Promise<Payer> {
  if (data.payerGuardianId && data.payerMemberId) throw new BadRequestError("Pick one payer");
  const named = new Map<string, Payer>();
  for (const id of new Set(data.lines.flatMap((l) => (l.enrollmentId ? [l.enrollmentId] : [])))) {
    const p = await defaultPayerFor(tx, data.studentId, id);
    named.set(payerKey(p), p);
  }
  const asked: Payer | undefined = data.payerGuardianId ? { kind: "guardian", guardianId: data.payerGuardianId } : data.payerMemberId ? { kind: "member", memberId: data.payerMemberId } : undefined;
  if (asked) {
    if (!(await payerInScope(tx, [data.studentId], asked))) throw new BadRequestError("That payer isn't one of this student's payers");
    return asked;
  }
  if (named.size > 1) throw new BadRequestError("These programs have different payers. Pick who pays.");
  return [...named.values()][0] ?? (await defaultPayerFor(tx, data.studentId));
}

// A draft of one-off charges for a student, billed to the payer given (the caller has checked the payer). via: where it was made, for the audit.
export async function addCharge(tx: Tx, by: Actor, input: { studentId: string; branchId: string; payer: Payer; lines: ManualLine[]; dueDate: string; via?: "collect" }, opts: { now?: Date } = {}): Promise<Invoice> {
  const [tenant, names] = await Promise.all([getOwnTenant(tx), payerNames(tx, [input.payer])]);
  const inv = await insertInvoice(tx, {
    tenantId: by.tenantId,
    branchId: input.branchId,
    studentId: input.studentId,
    ...payerColumns(input.payer),
    billToName: names.get(payerKey(input.payer)) ?? null,
    issueDate: todayIn(tenant?.timezone ?? "Asia/Kolkata", opts.now),
    dueDate: input.dueDate,
    createdBy: by.actorType === "staff" ? (by.actorId ?? null) : null,
  });
  await insertLines(tx, chargeRows(by.tenantId, inv.id, input.studentId, input.lines, Boolean(tenant?.gstin)));
  const done = await retotal(tx, inv, input.dueDate);
  await writeAudit(tx, { ...by, action: "invoice.create", entityType: "invoice", entityId: inv.id, after: { studentId: input.studentId, billToName: done.billToName, totalPaise: String(done.totalPaise), lines: auditLines(input.lines), ...(input.via ? { via: input.via } : {}) } });
  return done;
}

// Saved as a draft, or issued at once (the payer's advance then pays it). Due in a week unless a date is given.
export async function createInvoice(tx: Tx, ctx: ScopedCtx, input: z.input<typeof manualInvoiceSchema>, opts: { now?: Date } = {}): Promise<Invoice> {
  assertCan(ctx, "invoices:manage");
  const data = manualInvoiceSchema.parse(input);
  const student = await requireStudent(tx, ctx, data.studentId);
  const payer = await payerOfCharge(tx, data);
  const now = opts.now ?? new Date();
  if (data.issue) await lockInvoicing(tx, ctx.tenantId);
  const draft = await addCharge(tx, actor(ctx), { studentId: student.id, branchId: student.branchId, payer, lines: data.lines, dueDate: data.dueDate ?? addDays(todayIn(await timeZone(tx), now), 7) }, { now });
  if (!data.issue) return draft;
  await issueDrafts(tx, actor(ctx), [draft], { now });
  return requireInvoice(tx, ctx, draft.id);
}

// A draft added by hand, until it is issued. Generated drafts are fixed by correcting the plan and cancelling with "bill again".
export async function editDraft(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof editSchema>): Promise<Invoice> {
  assertCan(ctx, "invoices:manage");
  const data = editSchema.parse(input);
  await lockInvoicing(tx, ctx.tenantId);
  const before = await requireInvoice(tx, ctx, id);
  if (!(await lockDrafts(tx, ctx.branchIds, [id])).length) throw new ConflictError("Only a draft can be edited");
  const old = await linesOf(tx, [id]);
  if (!handmade(old)) throw new ConflictError("Only a charge added by hand can be edited");
  if (data.studentId !== before.studentId) throw new BadRequestError("A charge stays with its student");
  const payer = await payerOfCharge(tx, data);
  const [tenant, names] = await Promise.all([getOwnTenant(tx), payerNames(tx, [payer])]);
  const moved = await updateInvoice(tx, id, { ...payerColumns(payer), billToName: names.get(payerKey(payer)) ?? null, dueDate: data.dueDate ?? before.dueDate });
  await replaceLines(tx, id, chargeRows(ctx.tenantId, id, before.studentId, data.lines, Boolean(tenant?.gstin)));
  const after = await retotal(tx, moved, moved.dueDate);
  await writeAudit(tx, {
    ...actor(ctx),
    action: "invoice.edit",
    entityType: "invoice",
    entityId: id,
    before: { totalPaise: String(before.totalPaise), lines: auditLines(old.map((l) => ({ kind: l.kind, description: l.description, amountPaise: l.unitPaise }))) },
    after: { billToName: after.billToName, totalPaise: String(after.totalPaise), lines: auditLines(data.lines) },
  });
  return after;
}

// What the create sheet needs about one student: who can be billed, the programs a charge can name, GST on or off,
// and the programs whose admission fee a plan already billed (program id → invoice number).
export type CreateScreen = {
  student: { id: string; name: string; code: string; branchId: string };
  payers: { key: string; payer: Payer; name: string; relation: string | null }[];
  defaultPayerKey: string;
  enrollments: { id: string; programId: string; programName: string; batchName: string; payerKey: string }[]; // payerKey: who pays that placement
  gst: boolean;
  admissionBilled: Record<string, string>;
};

export async function createScreen(tx: Tx, ctx: ScopedCtx, studentId: string): Promise<CreateScreen> {
  assertCan(ctx, "invoices:manage");
  if (!isUuid(studentId)) throw new NotFoundError("Student");
  const s = await requireStudent(tx, ctx, studentId);
  const [live, placed, lead, fallback, tenant, billed] = await Promise.all([guardiansOfMembers(tx, [s.id]), currentEnrollmentsOf(tx, [s.id]), leadGuardians(tx, [s.id]), defaultPayerFor(tx, s.id), getOwnTenant(tx), admissionBilled(tx, s.id)]);
  // A placement with both payer columns set is left out, as billing leaves it out.
  const own = placed.flatMap((p) => {
    try {
      return [{ p, payer: planPayer(p.e, lead.get(s.id)) }];
    } catch {
      return [];
    }
  });
  const everyone = new Map([fallback, ...live.map((g): Payer => ({ kind: "guardian", guardianId: g.id })), ...own.map((o) => o.payer)].map((p) => [payerKey(p), p] as const));
  const names = await payerNames(tx, [...everyone.values()]);
  const relations = new Map(live.map((g) => [g.id, RELATION_LABELS[g.relation]] as const));
  return {
    student: { id: s.id, name: s.fullName, code: s.code, branchId: s.branchId },
    payers: [...everyone].map(([key, payer]) => ({ key, payer, name: names.get(key) ?? "", relation: payer.kind === "guardian" ? (relations.get(payer.guardianId) ?? null) : null })),
    defaultPayerKey: payerKey(fallback),
    enrollments: own.map(({ p, payer }) => ({ id: p.e.id, programId: p.programId, programName: p.programName, batchName: p.batchName, payerKey: payerKey(payer) })),
    gst: Boolean(tenant?.gstin),
    admissionBilled: Object.fromEntries(billed.map((b) => [b.programId, b.number ?? "a draft invoice"])),
  };
}

// A manual draft as the sheet shows it. The tax rate is worked back from the line's tax.
export type EditSeed = { id: string; payerKey: string; dueDate: string; lines: { kind: string; description: string; amountPaise: string; enrollmentId: string | null; taxRateBp: number }[] };

// The create sheet filled with a draft added by hand; null for any other invoice.
export async function editScreen(tx: Tx, ctx: ScopedCtx, id: string): Promise<{ screen: CreateScreen; seed: EditSeed } | null> {
  assertCan(ctx, "invoices:manage");
  if (!isUuid(id)) throw new NotFoundError("Invoice");
  const inv = await requireInvoice(tx, ctx, id);
  const lines = await linesOf(tx, [id]);
  if (inv.status !== "draft" || !handmade(lines)) return null;
  const [payer] = payerIfValid(inv);
  const seed: EditSeed = {
    id,
    payerKey: payer ? payerKey(payer) : "",
    dueDate: inv.dueDate,
    lines: lines.map((l) => ({ kind: l.kind, description: l.description, amountPaise: String(l.unitPaise), enrollmentId: l.enrollmentId, taxRateBp: l.unitPaise ? Number(roundHalfUp(l.taxPaise * 10_000n, l.unitPaise)) : 0 })),
  };
  return { screen: await createScreen(tx, ctx, inv.studentId), seed };
}

export const voidSchema = z.object({ reason: z.string().trim().min(3, "Add a reason").max(200), rebill: z.boolean().default(false) });

export async function voidInvoice(tx: Tx, ctx: ScopedCtx, id: string, input: z.input<typeof voidSchema>, opts: { now?: Date } = {}): Promise<Invoice> {
  assertCan(ctx, "invoices:manage");
  const data = voidSchema.parse(input);
  await requireInvoice(tx, ctx, id);
  return voidAndRebill(tx, actor(ctx), id, data.reason, data.rebill, opts.now);
}

export type DueInstallment = OpenInstallment & { voidable: boolean };

// Installments stay due when a student leaves (docs/03 §6); the leave screens list
// them. Voiding one with money on it moves the money to the family's advance.
export async function installmentsDue(tx: Tx, ctx: ScopedCtx, studentId: string): Promise<DueInstallment[]> {
  assertCan(ctx, "invoices:read");
  await requireStudent(tx, ctx, studentId);
  const canVoid = allows(ctx, "invoices:manage");
  return (await openInstallments(tx, ctx.branchIds, studentId)).map((i) => ({ ...i, voidable: canVoid }));
}

export async function nextDue(tx: Tx, ctx: ScopedCtx, studentId: string): Promise<string | null> {
  assertCan(ctx, "invoices:read");
  await requireStudent(tx, ctx, studentId);
  return nextDueDate(tx, ctx.branchIds, studentId);
}

export async function studentFees(tx: Tx, ctx: ScopedCtx, studentId: string, opts: { now?: Date } = {}): Promise<{ today: string; discounts: GivenDiscount[]; invoices: InvoiceRow[] }> {
  assertCan(ctx, "invoices:read");
  await requireStudent(tx, ctx, studentId);
  const today = todayIn(await timeZone(tx), opts.now);
  const [discounts, invoices] = await Promise.all([discountsOf(tx, [studentId]), listInvoices(tx, ctx.branchIds, { today, studentId, limit: 50 })]);
  return { today, discounts, invoices };
}

// ---- settings (docs/04 "GST", docs/03 §8 proration)

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const feeSettingsSchema = z.object({
  gstin: z.string().trim().toUpperCase().nullable().optional(),
  proration: z.enum(["full", "daily"]).optional(),
});

export async function saveFeeSettings(tx: Tx, ctx: ScopedCtx, input: z.input<typeof feeSettingsSchema>): Promise<{ gstin: string | null; proration: "full" | "daily" }> {
  assertCan(ctx, "settings:manage");
  const data = feeSettingsSchema.parse(input);
  if (data.gstin && !GSTIN.test(data.gstin)) throw new BadRequestError("A GSTIN has 15 characters, like 27ABCDE1234F1Z5");
  const before = await getOwnTenant(tx);
  const after = await updateOwnTenant(tx, ctx.tenantId, { ...(data.gstin !== undefined ? { gstin: data.gstin || null } : {}), ...(data.proration ? { proration: data.proration } : {}) });
  await writeAudit(tx, { ...actor(ctx), action: "settings.fees", entityType: "tenant", entityId: ctx.tenantId, before: { gstin: before?.gstin, proration: before?.proration }, after: { gstin: after.gstin, proration: after.proration } });
  return { gstin: after.gstin, proration: after.proration };
}
