import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import { writeAudit } from "@/lib/db/audit";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { formatDate, timeIn } from "@/lib/dates";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { tenantOrigin } from "@/lib/tenant/origin";
import { classRoster } from "@/modules/attendance/service";
import { invoiceDetail } from "@/modules/fees/service";
import { whatsappMessage, whatsappNumber } from "@/modules/integrations/service";
import { receipt } from "@/modules/payments/service";
import { guardiansOfHousehold, guardiansOfStudent } from "@/modules/students/repo";
import type { Guardian } from "@/modules/students/schema";
import { requireStudent } from "@/modules/students/service";
import { getOwnTenant, updateOwnTenant } from "@/modules/tenancy/repo";
import type { MessagingAdapter } from "./adapter";
import { makeShareLink, sharePath } from "./links";
import { countToSend, getMessage, insertMessage, listMessages, messageByProviderId, type MessageRow, templateRows, updateMessage, upsertTemplate } from "./repo";
import type { MessageLog, MessageStatus, ShareKind } from "./schema";
import { DEFAULT_TEMPLATES, joinNames, LANGUAGES, type Language, render, TEMPLATE_CATEGORY, TEMPLATE_KEYS, TEMPLATE_LABELS, TEMPLATE_VARIABLES, type TemplateKey, toMetaTemplate, variablesIn } from "./templates";

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
const actorOf = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });

const recipients = (gs: Guardian[]): Recipient[] => [...gs].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((g) => ({ name: g.fullName, phone: g.phone }));

// docs/06 Prompt 17 step 1: the message text from a template, for staff to
// copy or open in WhatsApp themselves. Nothing is sent from here.
export async function composeMessage(tx: Tx, ctx: ScopedCtx, input: ComposeRequest, opts: { now?: Date } = {}): Promise<Composed> {
  assertCan(ctx, "messages:send");
  const req = composeSchema.parse(input);
  const tenant = await getOwnTenant(tx);
  if (!tenant) throw new NotFoundError("Academy");
  const { body } = await templateFor(tx, req.key, tenant.messageLanguage);
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

// ---- templates (step 2): the academy's wording, or the default

export type TemplateView = { key: TemplateKey; label: string; language: Language; body: string; isDefault: boolean; isActive: boolean; providerTemplateName: string | null; variables: string[] };

async function templateViews(tx: Tx, language: Language): Promise<TemplateView[]> {
  const rows = await templateRows(tx, language);
  return TEMPLATE_KEYS.map((key) => {
    const row = rows.find((r) => r.key === key);
    return {
      key,
      label: TEMPLATE_LABELS[key],
      language,
      body: row?.body ?? DEFAULT_TEMPLATES[key][language],
      isDefault: !row || row.body === DEFAULT_TEMPLATES[key][language],
      isActive: row?.isActive ?? true,
      providerTemplateName: row?.providerTemplateName ?? null,
      variables: TEMPLATE_VARIABLES[key],
    };
  });
}

export async function templateFor(tx: Tx, key: TemplateKey, language: Language): Promise<TemplateView> {
  const t = (await templateViews(tx, language)).find((v) => v.key === key);
  if (!t) throw new Error(`templateFor: ${key}`);
  return t;
}

export async function messageTemplates(tx: Tx, ctx: ScopedCtx): Promise<TemplateView[]> {
  assertCan(ctx, "messages:manage");
  return templateViews(tx, (await getOwnTenant(tx))?.messageLanguage ?? "en");
}

export const templateSchema = z.object({
  body: z.string().trim().min(10, "Write the message").max(1000).optional(),
  isActive: z.boolean().optional(),
  reset: z.boolean().optional(),
  // The approved template's name in Meta; empty clears it.
  providerTemplateName: z.union([z.literal(""), z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Use the name exactly as in Meta: small letters, numbers and _")]).optional(),
});

// docs/03 §10: the body is editable, and turning a template off stops its sends.
export async function saveTemplate(tx: Tx, ctx: ScopedCtx, key: TemplateKey, input: z.input<typeof templateSchema>): Promise<TemplateView> {
  assertCan(ctx, "messages:manage");
  if (!TEMPLATE_KEYS.includes(key)) throw new NotFoundError("Template");
  const data = templateSchema.parse(input);
  const language = (await getOwnTenant(tx))?.messageLanguage ?? "en";
  const current = await templateFor(tx, key, language);
  const body = data.reset ? DEFAULT_TEMPLATES[key][language] : (data.body ?? current.body);
  const unknown = variablesIn(body).filter((v) => !TEMPLATE_VARIABLES[key].includes(v));
  if (unknown.length) throw new BadRequestError(`This message can't use {{${unknown[0]}}}. It can use ${TEMPLATE_VARIABLES[key].map((v) => `{{${v}}}`).join(", ")}`);
  const isActive = data.isActive ?? current.isActive;
  const providerTemplateName = data.providerTemplateName === undefined ? current.providerTemplateName : data.providerTemplateName || null;
  await upsertTemplate(tx, { tenantId: ctx.tenantId, key, language, body, isActive, providerTemplateName, updatedBy: ctx.staffId });
  await writeAudit(tx, { ...actorOf(ctx), action: "message_template.update", entityType: "tenant", entityId: ctx.tenantId, after: { key, language, isActive, providerTemplateName, reset: Boolean(data.reset) } });
  return templateFor(tx, key, language);
}

// ---- settings: language, send hours and the daily cap (agreed 2026-09-25)

export const messagingSettingsSchema = z.object({
  language: z.enum(LANGUAGES),
  sendHour: z.number().int().min(7).max(21),
  absenceHour: z.number().int().min(7).max(21),
  dailyCap: z.number().int().min(1, "At least 1 a day").max(100_000),
});
export type MessagingSettings = z.infer<typeof messagingSettingsSchema>;

export async function messagingSettings(tx: Tx, ctx: ScopedCtx): Promise<MessagingSettings> {
  assertCan(ctx, "messages:manage");
  const t = await getOwnTenant(tx);
  return { language: t?.messageLanguage ?? "en", sendHour: t?.messageSendHour ?? 10, absenceHour: t?.absenceSendHour ?? 19, dailyCap: t?.messageDailyCap ?? 250 };
}

export async function saveMessagingSettings(tx: Tx, ctx: ScopedCtx, input: z.input<typeof messagingSettingsSchema>): Promise<MessagingSettings> {
  assertCan(ctx, "messages:manage");
  const d = messagingSettingsSchema.parse(input);
  const before = await messagingSettings(tx, ctx);
  await updateOwnTenant(tx, ctx.tenantId, { messageLanguage: d.language, messageSendHour: d.sendHour, absenceSendHour: d.absenceHour, messageDailyCap: d.dailyCap });
  await writeAudit(tx, { ...actorOf(ctx), action: "settings.messaging", entityType: "tenant", entityId: ctx.tenantId, before, after: d });
  return d;
}

// ---- the log: what automated sending made, and what staff do with it

export type QueueInput = {
  key: TemplateKey;
  guardian: Pick<Guardian, "id" | "fullName" | "phone" | "whatsappOptin">;
  vars: Record<string, string>;
  related?: { type: string; id: string };
  dedupeKey?: string;
  sendAfter?: Date;
};

// Automated messages only (docs/03 §10): to a guardian who opted in, while the
// template is on; a repeat dedupe key makes nothing. Returns the new row. It
// goes through WhatsApp when connected and the template is approved in Meta.
export async function queueMessage(tx: Tx, tenantId: string, input: QueueInput): Promise<MessageLog | undefined> {
  if (!input.guardian.whatsappOptin) return undefined;
  const tenant = await getOwnTenant(tx);
  if (!tenant) throw new NotFoundError("Academy");
  const t = await templateFor(tx, input.key, tenant.messageLanguage);
  if (!t.isActive) return undefined;
  const vars = { academy: tenant.name, guardian_name: input.guardian.fullName, ...input.vars };
  return insertMessage(tx, {
    tenantId,
    guardianId: input.guardian.id,
    toPhone: input.guardian.phone,
    channel: t.providerTemplateName && (await whatsappNumber(tx)) !== null ? "whatsapp" : "manual",
    templateKey: input.key,
    category: TEMPLATE_CATEGORY[input.key],
    language: tenant.messageLanguage,
    variables: vars,
    body: render(t.body, vars),
    relatedType: input.related?.type ?? null,
    relatedId: input.related?.id ?? null,
    dedupeKey: input.dedupeKey ?? null,
    ...(input.sendAfter ? { sendAfter: input.sendAfter } : {}),
  });
}

// One queued message through the academy's adapter (the send job, step 4).
// The template is read again: one turned off since is skipped, and one no
// longer approved in Meta, or no WhatsApp, waits under To send.
export async function deliverMessage(tx: Tx, m: MessageLog, adapter: MessagingAdapter, opts: { now?: Date } = {}): Promise<MessageLog> {
  const t = await templateFor(tx, m.templateKey, m.language);
  if (!t.isActive) return updateMessage(tx, m.id, { status: "skipped", error: "The template was turned off" });
  if (adapter.channel === "manual" || !t.providerTemplateName) return updateMessage(tx, m.id, { channel: "manual" });
  // Meta refuses an empty variable.
  const variables = toMetaTemplate(t.body).names.map((n) => m.variables[n] || "-");
  try {
    const wamid = await adapter.deliver({ to: m.toPhone, templateName: t.providerTemplateName, language: m.language, variables });
    return updateMessage(tx, m.id, { channel: "whatsapp", status: "sent", providerMessageId: wamid, sentAt: opts.now ?? new Date(), attempts: m.attempts + 1, error: null });
  } catch (e) {
    return updateMessage(tx, m.id, { channel: "whatsapp", status: "failed", error: whatsappMessage(e), attempts: m.attempts + 1 });
  }
}

const PROGRESS: MessageStatus[] = ["queued", "sent", "delivered", "read"];

// Meta's delivery reports come in any order: a status only moves forward, and
// a failure after delivery is ignored. Returns why nothing changed, if so.
export async function applyDeliveryStatus(tx: Tx, wamid: string, status: "sent" | "delivered" | "read" | "failed", error: string | null): Promise<string | null> {
  const m = await messageByProviderId(tx, wamid);
  if (!m) return "no message here with this id";
  const at = PROGRESS.indexOf(m.status);
  if (at < 0) return `the message is ${m.status}`;
  if (status === "failed") {
    if (at >= PROGRESS.indexOf("delivered")) return "already delivered";
    await updateMessage(tx, m.id, { status: "failed", error: error ?? "WhatsApp couldn't deliver it" });
  } else if (PROGRESS.indexOf(status) > at) {
    await updateMessage(tx, m.id, { status });
  }
  return null;
}

export const LOG_VIEWS = ["to_send", "sent", "failed"] as const;
export type LogView = (typeof LOG_VIEWS)[number];

export async function messageLogView(tx: Tx, ctx: ScopedCtx, view: LogView): Promise<{ messages: MessageRow[]; toSend: number }> {
  assertCan(ctx, "messages:read");
  const messages =
    view === "to_send" ? await listMessages(tx, ["queued"], { channel: "manual" }) : view === "failed" ? await listMessages(tx, ["failed"]) : await listMessages(tx, ["sent", "delivered", "read", "skipped"]);
  return { messages, toSend: await countToSend(tx) };
}

export const MESSAGE_ACTIONS = ["sent", "skip", "retry"] as const;

// Sent by hand (a person tapped Open WhatsApp), skipped, or a failed one tried again.
export async function messageAction(tx: Tx, ctx: ScopedCtx, id: string, action: (typeof MESSAGE_ACTIONS)[number]): Promise<MessageLog> {
  assertCan(ctx, "messages:send");
  const m = await getMessage(tx, id);
  if (!m) throw new NotFoundError("Message");
  if (action === "sent") {
    if (m.status !== "queued" || m.channel !== "manual") throw new ConflictError("Only a message waiting to be sent by hand");
    return updateMessage(tx, id, { status: "sent", sentAt: new Date(), sentBy: ctx.staffId });
  }
  if (action === "skip") {
    if (m.status !== "queued") throw new ConflictError("Only a waiting message can be skipped");
    return updateMessage(tx, id, { status: "skipped", sentBy: ctx.staffId });
  }
  if (m.status !== "failed") throw new ConflictError("Only a failed message can be tried again");
  return updateMessage(tx, id, { status: "queued", error: null, sendAfter: new Date() });
}
