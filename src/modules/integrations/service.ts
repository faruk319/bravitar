import { z } from "zod";
import { assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { open, seal } from "@/lib/crypto";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { httpRazorpay, type RazorpayApi, type RazorpayCredentials, RazorpayError } from "./razorpay";
import { getIntegration, lastWebhookAt, saveIntegration, setIntegrationError } from "./repo";

const actor = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId, tenantId: ctx.tenantId });
// Sealed secrets are bound to whose they are (src/lib/crypto).
const sealedFor = (tenantId: string) => `tenant:${tenantId}:razorpay`;

// The academy's own Razorpay keys, or none. The row comes through RLS and its
// seal is bound to the tenant, so it is never another academy's; there is no
// fallback to an environment key. Our own SaaS billing has its own path.
// Inactive rows still answer for webhooks of links already sent.
export async function razorpayKeys(tx: Tx, opts: { includeInactive?: boolean } = {}): Promise<RazorpayCredentials | undefined> {
  const row = await getIntegration(tx, "razorpay");
  if (!row || (!row.isActive && !opts.includeInactive)) return undefined;
  return JSON.parse(open(row.credentials, sealedFor(row.tenantId))) as RazorpayCredentials;
}

// What to tell staff when Razorpay says no. Never includes a key.
export function razorpayMessage(e: unknown): string {
  if (!(e instanceof RazorpayError)) throw e;
  if (e.kind === "auth") return "Razorpay didn't accept these keys. Check the key id and secret in your Razorpay dashboard.";
  if (e.kind === "network") return "Couldn't reach Razorpay. Try again in a minute.";
  return `Razorpay said: ${e.message}`;
}

export type RazorpayStatus = { connected: boolean; keyId: string | null; mode: "test" | "live" | null; connectedAt: Date | null; lastError: string | null; lastWebhookAt: Date | null };

export async function razorpayStatus(tx: Tx, ctx: ScopedCtx): Promise<RazorpayStatus> {
  assertCan(ctx, "integrations:manage");
  const [row, webhook] = await Promise.all([getIntegration(tx, "razorpay"), lastWebhookAt(tx)]);
  return {
    connected: Boolean(row?.isActive),
    keyId: row?.config.keyId ?? null,
    mode: row?.config.mode ?? null,
    connectedAt: row?.connectedAt ?? null,
    lastError: row?.lastError ?? null,
    lastWebhookAt: webhook,
  };
}

// Whether payment links can be made; nothing about the keys.
export async function razorpayConnected(tx: Tx): Promise<boolean> {
  return Boolean((await getIntegration(tx, "razorpay"))?.isActive);
}

export const connectSchema = z.object({
  keyId: z
    .string()
    .trim()
    .regex(/^rzp_(test|live)_[A-Za-z0-9]{6,}$/, "A key id looks like rzp_live_… or rzp_test_…"),
  keySecret: z.string().trim().min(8, "Paste the key secret").max(200),
  webhookSecret: z.string().trim().min(8, "Paste the webhook secret you set in Razorpay").max(200),
});

// docs/04 "Who receives the money": the academy's own account. The keys are
// checked with Razorpay before they are sealed and saved; audited without them.
export async function connectRazorpay(tx: Tx, ctx: ScopedCtx, input: z.input<typeof connectSchema>, opts: { api?: RazorpayApi; now?: Date } = {}): Promise<RazorpayStatus> {
  assertCan(ctx, "integrations:manage");
  const keys = connectSchema.parse(input);
  try {
    await (opts.api ?? httpRazorpay)(keys).verify();
  } catch (e) {
    throw new BadRequestError(razorpayMessage(e));
  }
  const before = await getIntegration(tx, "razorpay");
  const mode = keys.keyId.startsWith("rzp_test_") ? ("test" as const) : ("live" as const);
  const row = await saveIntegration(tx, {
    tenantId: ctx.tenantId,
    kind: "razorpay",
    credentials: seal(JSON.stringify(keys), sealedFor(ctx.tenantId)),
    config: { keyId: keys.keyId, mode },
    connectedAt: opts.now ?? new Date(),
    connectedBy: ctx.staffId,
  });
  await writeAudit(tx, {
    ...actor(ctx),
    action: before ? "integration.update" : "integration.connect",
    entityType: "integration",
    entityId: row.id,
    ...(before ? { before: { keyId: before.config.keyId ?? null, mode: before.config.mode ?? null } } : {}),
    after: { kind: "razorpay", keyId: keys.keyId, mode },
  });
  return razorpayStatus(tx, ctx);
}

// The "test connection" button: the saved keys, checked again.
export async function testRazorpay(tx: Tx, ctx: ScopedCtx, opts: { api?: RazorpayApi } = {}): Promise<RazorpayStatus> {
  assertCan(ctx, "integrations:manage");
  const row = await getIntegration(tx, "razorpay");
  const keys = await razorpayKeys(tx, { includeInactive: true });
  if (!row || !keys) throw new NotFoundError("Razorpay connection");
  let lastError: string | null = null;
  try {
    await (opts.api ?? httpRazorpay)(keys).verify();
  } catch (e) {
    lastError = razorpayMessage(e);
  }
  await setIntegrationError(tx, row.id, lastError);
  return razorpayStatus(tx, ctx);
}
