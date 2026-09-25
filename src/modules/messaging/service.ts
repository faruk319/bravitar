import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { tenantOrigin } from "@/lib/tenant/origin";
import { whatsappMessage, whatsappNumber } from "@/modules/integrations/service";
import type { Guardian } from "@/modules/students/schema";
import { getOwnTenant, updateOwnTenant } from "@/modules/tenancy/repo";
import type { MessagingAdapter } from "./adapter";
import { makeShareLink, sharePath } from "./links";
import { countToSend, dedupeKeysTaken, getMessage, insertMessage, listMessages, messageByProviderId, type MessageRow, templateRows, updateMessage, upsertTemplate } from "./repo";
import { hourFor, QUIET_FROM, QUIET_UNTIL, sendTime } from "./schedule";
import type { MessageLog, MessageStatus, ShareKind } from "./schema";
import { DEFAULT_TEMPLATES, LANGUAGES, type Language, render, TEMPLATE_CATEGORY, TEMPLATE_KEYS, TEMPLATE_LABELS, TEMPLATE_VARIABLES, type TemplateKey, toMetaTemplate, variablesIn } from "./templates";

const actorOf = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });

// Primary guardian first: the one automated messages go to (docs/03 §10).
export const byPrimary = <G extends Pick<Guardian, "isPrimary">>(gs: G[]): G[] => [...gs].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

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
  sendHour: z.number().int().min(QUIET_UNTIL).max(QUIET_FROM - 1),
  absenceHour: z.number().int().min(QUIET_UNTIL).max(QUIET_FROM - 1),
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
  link?: { kind: ShareKind; id: string }; // becomes {{link}}
  related?: { type: "invoice" | "attendance" | "payment"; id: string };
  dedupeKey?: string;
};

// Automated messages only (docs/03 §10): to a guardian who opted in, while the
// template is on; a repeat dedupe key makes nothing. Returns the new row, due
// at its category's hour. It goes through WhatsApp when connected and the
// template is approved in Meta.
export async function queueMessage(tx: Tx, tenantId: string, input: QueueInput, opts: { now?: Date } = {}): Promise<MessageLog | undefined> {
  if (!input.guardian.whatsappOptin) return undefined;
  const tenant = await getOwnTenant(tx);
  if (!tenant) throw new NotFoundError("Academy");
  const t = await templateFor(tx, input.key, tenant.messageLanguage);
  if (!t.isActive || (input.dedupeKey && (await dedupeKeysTaken(tx, [input.dedupeKey])).size)) return undefined;
  const link = input.link ? { link: `${tenantOrigin(tenant.slug)}${sharePath(input.link.kind, await makeShareLink(tx, { actorType: "system", tenantId }, input.link.kind, input.link.id))}` } : {};
  const vars = { academy: tenant.name, guardian_name: input.guardian.fullName, ...input.vars, ...link };
  const category = TEMPLATE_CATEGORY[input.key];
  return insertMessage(tx, {
    tenantId,
    guardianId: input.guardian.id,
    toPhone: input.guardian.phone,
    channel: t.providerTemplateName && (await whatsappNumber(tx)) !== null ? "whatsapp" : "manual",
    templateKey: input.key,
    category,
    language: tenant.messageLanguage,
    variables: vars,
    body: render(t.body, vars),
    relatedType: input.related?.type ?? null,
    relatedId: input.related?.id ?? null,
    dedupeKey: input.dedupeKey ?? null,
    sendAfter: sendTime(opts.now ?? new Date(), tenant.timezone, hourFor(category, tenant)),
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

// To send: what is due now for staff to send by hand.
export async function messageLogView(tx: Tx, ctx: ScopedCtx, view: LogView, opts: { now?: Date } = {}): Promise<{ messages: MessageRow[]; toSend: number }> {
  assertCan(ctx, "messages:read");
  const now = opts.now ?? new Date();
  const messages =
    view === "to_send"
      ? await listMessages(tx, ["queued"], { channel: "manual", dueBy: now })
      : view === "failed"
        ? await listMessages(tx, ["failed"])
        : await listMessages(tx, ["sent", "delivered", "read", "skipped"]);
  return { messages, toSend: await countToSend(tx, now) };
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
