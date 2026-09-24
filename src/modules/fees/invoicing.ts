import { type AuditEntry, writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { addDays, formatDate, todayIn } from "@/lib/dates";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { Paise } from "@/lib/money/paise";
import type { Enrollment } from "@/modules/enrollments/schema";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { type Cycle, invoiceTotals, type LineDiscount, lineAmounts, recurringCharges } from "./billing";
import {
  type Billable,
  billableEnrollments,
  clearKeys,
  discountsOf,
  enrollmentLinks,
  familyDraft,
  type GivenDiscount,
  getInvoice,
  insertInvoice,
  insertLines,
  invoicesAfterEnd,
  type Link,
  linesOf,
  lockInvoicing,
  takenKeys,
  updateInvoice,
} from "./repo";
import type { Invoice } from "./schema";

export type Actor = Pick<AuditEntry, "actorType" | "actorId"> & { tenantId: string };

// A cycle that started up to a week ago is still billed, so a missed night catches up.
export const LOOKBACK_DAYS = 7;
const EVER = "0001-01-01";

type Charge = {
  b: Billable;
  key: string; // billing_key: the same charge is never billed twice
  kind: "tuition" | "admission";
  description: string;
  period: { start: string | null; end: string | null };
  issueDate: string;
  dueDate: string;
  unit: Paise;
  on: string; // discounts valid on this day apply
  group: string; // charges in a group share an invoice
  studentId: string | null; // set on one-student invoices (installments)
  opens: boolean; // first charge of the student's first enrollment in the program
};

type Chains = { prev: (id: string) => Link | undefined; root: (e: Enrollment) => { id: string; startDate: string }; firstInProgram: (studentId: string, programId: string) => string | undefined };

function chains(links: Link[]): Chains {
  const prevOf = new Map(links.flatMap((l) => (l.next ? [[l.next, l] as const] : [])));
  const firsts = new Map<string, Link>();
  for (const l of links) {
    const k = `${l.studentId}|${l.programId}`;
    const f = firsts.get(k);
    if (!f || l.startDate < f.startDate || (l.startDate === f.startDate && l.createdAt < f.createdAt)) firsts.set(k, l);
  }
  return {
    prev: (id) => prevOf.get(id),
    root(e) {
      let cur: { id: string; startDate: string } = e;
      for (let p = prevOf.get(e.id), n = 0; p && n < links.length; p = prevOf.get(p.id), n++) cur = p;
      return cur;
    },
    firstInProgram: (studentId, programId) => firsts.get(`${studentId}|${programId}`)?.id,
  };
}

const openOn = (e: Enrollment, day: string) => e.startDate <= day && (e.endDate === null || e.endDate >= day) && !(e.status === "paused" && e.pausedOn && e.pausedOn <= day);

function chargesFor(b: Billable, c: { today: string; from: string; proration: "full" | "daily"; chain: Chains; rebill: boolean }): Omit<Charge, "b">[] {
  const { e, plan } = b;
  const first = c.chain.firstInProgram(e.studentId, b.programId) === e.id;
  if (plan.kind === "recurring") {
    const all = recurringCharges(
      {
        cycle: plan.billingCycle as Cycle,
        billingDay: plan.billingDay,
        amount: plan.amountPaise,
        proration: c.proration,
        anchor: c.chain.root(e).startDate,
        start: e.startDate,
        end: e.endDate,
        pausedOn: e.pausedOn,
        continuing: c.chain.prev(e.id)?.planKind === "recurring",
      },
      EVER,
      c.today,
    );
    return all
      .filter((ch) => ch.issueDate >= c.from)
      .map((ch) => ({
        key: `tuition|${e.id}|${ch.period.start}`,
        kind: "tuition",
        description: ch.prorated ? `${plan.name} (part)` : plan.name,
        period: ch.period,
        issueDate: ch.issueDate,
        dueDate: addDays(ch.issueDate, plan.graceDays),
        unit: ch.amount,
        on: ch.issueDate,
        group: `family|${b.householdId}|${b.branchId}|${ch.issueDate}`,
        studentId: null,
        opens: first && ch === all[0],
      }));
  }
  if (plan.kind === "package") return []; // TODO(V2): package credits (docs/04). Stored, never billed yet.
  // Term and one-time: every installment at once, one invoice each, due from the start date.
  if (!openOn(e, c.today)) return [];
  const parts =
    plan.kind === "term" ? (plan.metadata.installments ?? []).map((i) => ({ label: `${i.label} · ${plan.name}`, amount: BigInt(i.amount_paise), offset: i.due_offset_days })) : [{ label: plan.name, amount: plan.amountPaise, offset: 0 }];
  const root = c.chain.root(e).id; // a move keeping the same plan doesn't bill it again
  return parts.map((p, i) => {
    const key = `installment|${root}|${plan.id}|${i}`;
    const due = addDays(e.startDate, p.offset);
    return { key, kind: "tuition", description: p.label, period: { start: null, end: null }, issueDate: e.startDate, dueDate: due, unit: p.amount, on: due, group: `own|${key}`, studentId: e.studentId, opens: first && i === 0 && (c.rebill || e.startDate >= c.from) };
  });
}

const admissionFor = (c: Charge): Charge => ({
  ...c,
  key: `admission|${c.b.e.studentId}|${c.b.programId}`,
  kind: "admission",
  description: `Admission · ${c.b.programName}`,
  unit: c.b.plan.admissionFeePaise,
  opens: false,
});

const validOn = (g: GivenDiscount, day: string) => g.validFrom <= day && (g.validTo === null || g.validTo >= day);

export type GenerateOptions = { now?: Date; enrollmentIds?: string[]; onlyKeys?: Set<string> };
export type GenerateResult = { invoices: number; lines: number };

// docs/03 §8: drafts per family, branch and billing day; installments get their own.
// Re-running bills nothing twice. onlyKeys re-bills exactly those charges.
export async function generateInvoices(tx: Tx, actor: Actor, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const tenant = await getOwnTenant(tx);
  if (!tenant?.enabledModules.fees) return { invoices: 0, lines: 0 };
  await lockInvoicing(tx, actor.tenantId);
  const today = todayIn(tenant.timezone, opts.now);
  const only = opts.onlyKeys;
  const from = only ? EVER : addDays(today, -LOOKBACK_DAYS);
  const billables = await billableEnrollments(tx, { from, to: today, ...(opts.enrollmentIds ? { ids: opts.enrollmentIds } : {}) });
  const studentIds = [...new Set(billables.map((b) => b.e.studentId))];
  const [links, given] = await Promise.all([enrollmentLinks(tx, studentIds), discountsOf(tx, studentIds)]);
  const chain = chains(links);

  const wanted = (c: Charge) => !only || only.has(c.key);
  const charges = billables.flatMap((b) => chargesFor(b, { today, from, proration: tenant.proration, chain, rebill: Boolean(only) }).map((c) => ({ ...c, b }))).filter(wanted);
  const admissions = charges.filter((c) => c.opens && c.b.plan.admissionFeePaise > 0n).map((host) => [host, admissionFor(host)] as const);
  const taken = await takenKeys(tx, [...charges, ...admissions.map(([, a]) => a)].map((c) => c.key));
  const fresh = [...charges.filter((c) => !taken.has(c.key)), ...admissions.filter(([host, a]) => !taken.has(host.key) && !taken.has(a.key) && wanted(a)).map(([, a]) => a)];

  const groups = new Map<string, Charge[]>();
  for (const c of fresh) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  for (const cs of groups.values()) {
    const head = cs[0];
    if (!head) continue;
    const due = cs.map((c) => c.dueDate).sort()[0] ?? head.dueDate;
    const inv =
      (head.studentId ? undefined : await familyDraft(tx, head.b.householdId, head.b.branchId, head.issueDate)) ??
      (await insertInvoice(tx, { tenantId: actor.tenantId, branchId: head.b.branchId, householdId: head.b.householdId, studentId: head.studentId, issueDate: head.issueDate, dueDate: due }));
    await insertLines(
      tx,
      cs.map((c) => {
        const discounts: LineDiscount[] = c.kind === "tuition" ? given.filter((g) => g.studentId === c.b.e.studentId && validOn(g, c.on)).map((g) => ({ name: g.name, reason: g.reason, kind: g.kind, value: g.value })) : [];
        const a = lineAmounts(c.unit, 1, discounts, tenant.gstin ? c.b.plan.taxRateBp : 0);
        return {
          tenantId: actor.tenantId,
          invoiceId: inv.id,
          enrollmentId: c.b.e.id,
          studentId: c.b.e.studentId,
          feePlanId: c.b.plan.id,
          kind: c.kind,
          description: c.description,
          periodStart: c.period.start,
          periodEnd: c.period.end,
          unitPaise: c.unit,
          discountPaise: a.discount,
          discountNote: a.discountNote,
          taxPaise: a.tax,
          amountPaise: a.net,
          billingKey: c.key,
        };
      }),
    );
    await retotal(tx, inv, due);
  }
  const result = { invoices: groups.size, lines: fresh.length };
  if (fresh.length) await writeAudit(tx, { ...actor, action: "invoice.generate", after: { ...result, rebill: Boolean(only) } });
  return result;
}

async function retotal(tx: Tx, inv: Invoice, due: string): Promise<void> {
  const lines = await linesOf(tx, [inv.id]);
  const t = invoiceTotals(lines.map((l) => ({ gross: l.unitPaise * BigInt(l.quantity), discount: l.discountPaise, tax: l.taxPaise })));
  const starts = lines.flatMap((l) => (l.periodStart ? [l.periodStart] : [])).sort();
  const ends = lines.flatMap((l) => (l.periodEnd ? [l.periodEnd] : [])).sort();
  await updateInvoice(tx, inv.id, {
    subtotalPaise: t.subtotal,
    discountPaise: t.discount,
    taxPaise: t.tax,
    totalPaise: t.total,
    periodStart: starts[0] ?? null,
    periodEnd: ends.at(-1) ?? null,
    dueDate: due < inv.dueDate ? due : inv.dueDate,
  });
}

// Void keeps the number (docs/04). With rebill, its charges are drafted again
// from today's plans and discounts; without, they stay billed.
export async function voidAndRebill(tx: Tx, actor: Actor, id: string, reason: string, rebill: boolean, now?: Date): Promise<Invoice> {
  await lockInvoicing(tx, actor.tenantId);
  const inv = await getInvoice(tx, [], id);
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.status === "void") throw new ConflictError("Already void");
  if (inv.paidPaise > 0n) throw new ConflictError("This invoice has payments");
  const after = await updateInvoice(tx, id, { status: "void", voidReason: reason });
  await writeAudit(tx, { ...actor, action: "invoice.void", entityType: "invoice", entityId: id, before: { status: inv.status, number: inv.number }, after: { reason, rebill } });
  const lines = rebill ? await linesOf(tx, [id]) : [];
  const keys = new Set(lines.flatMap((l) => (l.billingKey ? [l.billingKey] : [])));
  if (keys.size) {
    await clearKeys(tx, id);
    await generateInvoices(tx, actor, { ...(now ? { now } : {}), onlyKeys: keys, enrollmentIds: [...new Set(lines.flatMap((l) => (l.enrollmentId ? [l.enrollmentId] : [])))] });
  }
  return after;
}

// After a batch is left or moved: unpaid invoices billing it for after the last
// day are voided and drafted again without it. Term installments stay.
export async function endCharges(tx: Tx, actor: Actor, enrollmentIds: string[], now?: Date): Promise<void> {
  for (const hit of await invoicesAfterEnd(tx, enrollmentIds)) {
    const reason = `${hit.studentName} ${hit.moved ? "moved from" : "left"} ${hit.batchName}, last day ${formatDate(hit.lastDay)}`;
    await voidAndRebill(tx, actor, hit.invoice.id, reason, true, now);
  }
}
