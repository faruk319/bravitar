import { z } from "zod";
import { allows, assertCan, ForbiddenError } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, isIsoDate, todayIn } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { type Paise, sum } from "@/lib/money/paise";
import { getProgram, listPrograms } from "@/modules/batches/repo";
import type { Program } from "@/modules/batches/schema";
import { allocateNumber, currentFy } from "@/modules/numbering/repo";
import { getHousehold } from "@/modules/students/repo";
import { requireStudent } from "@/modules/students/service";
import { getBranch, getOwnTenant, tenantToday, updateOwnTenant } from "@/modules/tenancy/repo";
import { isOverdue } from "./billing";
import { type GenerateResult, generateInvoices, voidAndRebill } from "./invoicing";
import {
  discountsOf,
  draftIds,
  draftSummary,
  type GivenDiscount,
  getDiscount,
  getInvoice,
  getPlan,
  getStudentDiscount,
  insertDiscount,
  insertPlan,
  insertStudentDiscount,
  type InvoiceRow,
  type InvoiceView,
  type LineRow,
  listDiscounts,
  listInvoices,
  listPlans,
  linesOf,
  lockDrafts,
  lockInvoicing,
  type OpenInstallment,
  openInstallments,
  type PlanRow,
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

export async function invoiceList(tx: Tx, ctx: ScopedCtx, view: InvoiceView, opts: { now?: Date } = {}): Promise<{ today: string; invoices: InvoiceRow[]; drafts: { count: number; total: Paise } }> {
  assertCan(ctx, "invoices:read");
  const today = todayIn(await timeZone(tx), opts.now);
  const [invoices, drafts] = await Promise.all([listInvoices(tx, ctx.branchIds, { view, today }), draftSummary(tx, ctx.branchIds)]);
  return { today, invoices, drafts };
}

async function requireInvoice(tx: Tx, ctx: ScopedCtx, id: string): Promise<Invoice> {
  const inv = await getInvoice(tx, ctx.branchIds, id);
  if (!inv) throw new NotFoundError("Invoice");
  return inv;
}

export type InvoiceDetail = {
  invoice: Invoice;
  overdue: boolean;
  householdName: string;
  lines: LineRow[];
  academy: { name: string; gstin: string | null; branch: string; address: string | null };
};

export async function invoiceDetail(tx: Tx, ctx: ScopedCtx, id: string, opts: { now?: Date } = {}): Promise<InvoiceDetail> {
  assertCan(ctx, "invoices:read");
  const invoice = await requireInvoice(tx, ctx, id);
  const [lines, household, tenant, branch] = await Promise.all([linesOf(tx, [id]), getHousehold(tx, invoice.householdId), getOwnTenant(tx), getBranch(tx, invoice.branchId)]);
  const today = todayIn(tenant?.timezone ?? "Asia/Kolkata", opts.now);
  return {
    invoice,
    overdue: isOverdue(invoice, today),
    householdName: household?.name ?? "",
    lines,
    academy: { name: tenant?.name ?? "", gstin: tenant?.gstin ?? null, branch: branch?.name ?? "", address: branch?.address ?? null },
  };
}

export async function generateNow(tx: Tx, ctx: ScopedCtx, opts: { now?: Date } = {}): Promise<GenerateResult> {
  assertCan(ctx, "invoices:manage");
  return generateInvoices(tx, actor(ctx), opts.now ? { now: opts.now } : {});
}

export const issueSchema = z.union([z.literal("all"), z.array(z.uuid()).min(1).max(1000)]);

// Draft → issued takes the next number in this transaction (docs/04), oldest first.
export async function issueInvoices(tx: Tx, ctx: ScopedCtx, input: z.input<typeof issueSchema>, opts: { now?: Date } = {}): Promise<Invoice[]> {
  assertCan(ctx, "invoices:manage");
  const ids = issueSchema.parse(input);
  await lockInvoicing(tx, ctx.tenantId);
  const now = opts.now ?? new Date();
  const today = todayIn(await timeZone(tx), now);
  const fy = await currentFy(tx, now);
  const drafts = await lockDrafts(tx, ctx.branchIds, ids === "all" ? await draftIds(tx, ctx.branchIds) : ids);
  if (!drafts.length) throw new ConflictError("Nothing to issue");
  const issued: Invoice[] = [];
  for (const d of drafts) {
    const number = await allocateNumber(tx, ctx.tenantId, "invoice", fy);
    // Nothing to pay (a full waiver) is paid on issue.
    const inv = await updateInvoice(tx, d.id, { number, fy, status: d.totalPaise === 0n ? "paid" : "issued", issueDate: today, dueDate: d.dueDate > today ? d.dueDate : today, issuedAt: now });
    await writeAudit(tx, { ...actor(ctx), action: "invoice.issue", entityType: "invoice", entityId: d.id, after: { number, totalPaise: String(inv.totalPaise) } });
    issued.push(inv);
  }
  return issued;
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
// them. Until payments land (Prompt 15), only an unpaid one can be voided.
export async function installmentsDue(tx: Tx, ctx: ScopedCtx, studentId: string): Promise<DueInstallment[]> {
  assertCan(ctx, "invoices:read");
  await requireStudent(tx, ctx, studentId);
  const canVoid = allows(ctx, "invoices:manage");
  return (await openInstallments(tx, ctx.branchIds, studentId)).map((i) => ({ ...i, voidable: canVoid && i.paidPaise === 0n }));
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
