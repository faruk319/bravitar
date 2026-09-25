import type { Tx } from "@/lib/db/client";
import { addDays, formatDate, todayIn } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { absencesOn } from "@/modules/attendance/repo";
import { linesOf, owedDueBetween } from "@/modules/fees/repo";
import type { Payment } from "@/modules/payments/schema";
import { guardiansOfHousehold, guardiansOfStudent } from "@/modules/students/repo";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { dedupeKeysTaken, skipAbout, skipStale } from "./repo";
import { FEE_WINDOW, feeStage, localHour } from "./schedule";
import { byPrimary, queueMessage } from "./service";
import { joinNames } from "./templates";

export type Reminded = { fees: number; absences: number; skipped: number };

// messages.remind (hourly, docs/03 §10): fee reminders from the academy's send
// hour, absence messages from its evening hour. Dedupe keys make every run
// safe to repeat; queued messages whose reason is gone are skipped first.
export async function queueReminders(tx: Tx, opts: { now?: Date } = {}): Promise<Reminded> {
  const now = opts.now ?? new Date();
  const tenant = await getOwnTenant(tx);
  if (!tenant) throw new NotFoundError("Academy");
  const today = todayIn(tenant.timezone, now);
  const hour = localHour(now, tenant.timezone);
  const out: Reminded = { fees: 0, absences: 0, skipped: await skipStale(tx) };

  if (hour >= tenant.messageSendHour) {
    const staged = (await owedDueBetween(tx, addDays(today, FEE_WINDOW.from), addDays(today, FEE_WINDOW.to))).flatMap((inv) => {
      const s = feeStage(inv.dueDate, today);
      return s ? [{ inv, key: s.key, dedupeKey: `${s.key}|${inv.id}|${s.stage}` }] : [];
    });
    const taken = await dedupeKeysTaken(tx, staged.map((s) => s.dedupeKey));
    const fresh = staged.filter((s) => !taken.has(s.dedupeKey));
    const names = new Map<string, Set<string>>();
    for (const l of await linesOf(tx, fresh.map((s) => s.inv.id))) if (l.studentName) names.set(l.invoiceId, (names.get(l.invoiceId) ?? new Set()).add(l.studentName));
    for (const { inv, key, dedupeKey } of fresh) {
      const guardian = byPrimary(await guardiansOfHousehold(tx, inv.householdId))[0];
      if (!guardian) continue;
      const vars = { student_names: joinNames([...(names.get(inv.id) ?? [])]), amount: formatPaise(inv.totalPaise - inv.paidPaise), due_date: formatDate(inv.dueDate), invoice_number: inv.number ?? "" };
      if (await queueMessage(tx, tenant.id, { key, guardian, vars, link: { kind: "invoice", id: inv.id }, related: { type: "invoice", id: inv.id }, dedupeKey }, { now })) out.fees++;
    }
  }

  if (hour >= tenant.absenceSendHour) {
    const absences = (await absencesOn(tx, today)).map((a) => ({ ...a, dedupeKey: `absent|${a.studentId}|${today}` })); // one a day per child
    const taken = await dedupeKeysTaken(tx, absences.map((a) => a.dedupeKey));
    for (const a of absences.filter((x) => !taken.has(x.dedupeKey))) {
      const guardian = byPrimary(await guardiansOfStudent(tx, a.studentId))[0];
      if (!guardian || guardian.relation === "self") continue; // an adult is their own contact
      const vars = { student_name: a.studentName, batch: a.batchName, date: formatDate(today) };
      if (await queueMessage(tx, tenant.id, { key: "absent", guardian, vars, related: { type: "attendance", id: a.id }, dedupeKey: a.dedupeKey }, { now })) out.absences++;
    }
  }
  return out;
}

// On a payment, from the desk or Razorpay: no reminder goes out for what it
// just paid, and its receipt is queued for the family's primary guardian.
export async function afterPayment(tx: Tx, payment: Payment, paidInvoiceIds: string[], opts: { now?: Date } = {}): Promise<void> {
  await skipAbout(tx, "invoice", paidInvoiceIds, "A payment came in first");
  const guardian = byPrimary(await guardiansOfHousehold(tx, payment.householdId))[0];
  if (!guardian) return;
  const vars = { amount: formatPaise(payment.amountPaise), date: formatDate(payment.receivedOn), receipt_number: payment.receiptNumber };
  await queueMessage(tx, payment.tenantId, { key: "receipt", guardian, vars, link: { kind: "receipt", id: payment.id }, related: { type: "payment", id: payment.id }, dedupeKey: `receipt|${payment.id}` }, opts);
}
