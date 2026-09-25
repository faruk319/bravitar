import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { formatDate, timeIn } from "@/lib/dates";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { tenantOrigin } from "@/lib/tenant/origin";
import { classRoster } from "@/modules/attendance/service";
import { invoiceDetail } from "@/modules/fees/service";
import { receipt } from "@/modules/payments/service";
import { guardiansOfHousehold, guardiansOfStudent } from "@/modules/students/repo";
import type { Guardian } from "@/modules/students/schema";
import { requireStudent } from "@/modules/students/service";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { makeShareLink, sharePath } from "./links";
import type { ShareKind } from "./schema";
import { DEFAULT_TEMPLATES, joinNames, render, type TemplateKey } from "./templates";

export const composeSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("fee_due"), invoiceId: z.uuid() }),
  z.object({ key: z.literal("fee_overdue"), invoiceId: z.uuid() }),
  z.object({ key: z.literal("receipt"), paymentId: z.uuid() }),
  z.object({ key: z.literal("absent"), sessionId: z.uuid(), studentId: z.uuid() }),
  z.object({ key: z.literal("class_cancelled"), sessionId: z.uuid() }),
  z.object({ key: z.literal("welcome"), studentId: z.uuid() }),
]);
export type ComposeRequest = z.input<typeof composeSchema>;

export type Recipient = { name: string; phone: string };
export type Draft = { about: string; to: Recipient[]; text: string };
export type Composed = { key: TemplateKey; drafts: Draft[] };

// Primary guardian first: the one reminders go to (docs/03 §10).
const recipients = (gs: Guardian[]): Recipient[] => [...gs].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((g) => ({ name: g.fullName, phone: g.phone }));

// docs/06 Prompt 17 step 1: the message text from a template, for staff to
// copy or open in WhatsApp themselves. Nothing is sent from here.
export async function composeMessage(tx: Tx, ctx: ScopedCtx, input: ComposeRequest, opts: { now?: Date } = {}): Promise<Composed> {
  assertCan(ctx, "messages:send");
  const req = composeSchema.parse(input);
  const tenant = await getOwnTenant(tx);
  if (!tenant) throw new NotFoundError("Academy");
  const body = DEFAULT_TEMPLATES[req.key][tenant.messageLanguage];
  const actor = { actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId };
  const link = async (kind: ShareKind, id: string) => `${tenantOrigin(tenant.slug)}${sharePath(kind, await makeShareLink(tx, actor, kind, id))}`;
  const draft = (about: string, to: Recipient[], vars: Record<string, string>): Draft => ({ about, to, text: render(body, { academy: tenant.name, guardian_name: to[0]?.name ?? "", ...vars }) });

  switch (req.key) {
    case "fee_due":
    case "fee_overdue": {
      const d = await invoiceDetail(tx, ctx, req.invoiceId, opts);
      const inv = d.invoice;
      if (inv.status !== "issued" && inv.status !== "part_paid") throw new ConflictError("Only an unpaid invoice gets a reminder");
      const names = [...new Set(d.lines.flatMap((l) => (l.studentName ? [l.studentName] : [])))];
      const to = recipients(await guardiansOfHousehold(tx, inv.householdId));
      return {
        key: req.key,
        drafts: [draft(d.householdName, to, { student_names: joinNames(names), amount: formatPaise(inv.totalPaise - inv.paidPaise), due_date: formatDate(inv.dueDate), invoice_number: inv.number ?? "", link: await link("invoice", inv.id) })],
      };
    }
    case "receipt": {
      const r = await receipt(tx, ctx, req.paymentId);
      if (r.payment.status === "cancelled") throw new ConflictError("This payment was cancelled");
      const to = recipients(await guardiansOfHousehold(tx, r.payment.householdId));
      return {
        key: "receipt",
        drafts: [draft(r.householdName, to, { amount: formatPaise(r.payment.amountPaise), date: formatDate(r.payment.receivedOn), receipt_number: r.payment.receiptNumber, link: await link("receipt", r.payment.id) })],
      };
    }
    case "absent": {
      const c = await classRoster(tx, ctx, req.sessionId, opts);
      const e = c.entries.find((x) => x.studentId === req.studentId);
      if (e?.mark !== "absent") throw new ConflictError("Not marked absent in this class");
      return { key: "absent", drafts: [draft(e.name, recipients(await guardiansOfStudent(tx, e.studentId)), { student_name: e.name, batch: c.batchName, date: formatDate(c.session.sessionDate) })] };
    }
    case "class_cancelled": {
      const c = await classRoster(tx, ctx, req.sessionId, opts);
      if (c.session.status !== "cancelled") throw new ConflictError("This class isn't cancelled");
      const vars = { batch: c.batchName, date: formatDate(c.session.sessionDate), time: timeIn(c.timeZone, c.session.startsAt), reason: c.session.cancelReason ?? "" };
      const drafts: Draft[] = [];
      for (const e of c.entries.filter((x) => !x.paused)) drafts.push(draft(e.name, recipients(await guardiansOfStudent(tx, e.studentId)), { ...vars, student_name: e.name }));
      return { key: "class_cancelled", drafts };
    }
    case "welcome": {
      const s = await requireStudent(tx, ctx, req.studentId);
      return { key: "welcome", drafts: [draft(s.fullName, recipients(await guardiansOfStudent(tx, s.id)), { student_name: s.fullName })] };
    }
  }
}
