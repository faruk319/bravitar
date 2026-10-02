import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { AuditEntry } from "@/lib/db/audit";
import { db } from "@/lib/db/client";
import { platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { NotFoundError } from "@/lib/errors";
import { webhookEvents } from "@/modules/integrations/schema";
import { getMessage } from "@/modules/messaging/repo";
import { messageLog } from "@/modules/messaging/schema";
import { requeue } from "@/modules/messaging/service";
import type { TemplateKey } from "@/modules/messaging/templates";
import { tenants } from "@/modules/tenancy/schema";

// /platform/queues (Prompt 21), across academies: failed WhatsApp messages,
// webhooks that failed or were never processed, and the job queue's health.

const LIMIT = 50;
const STUCK_MINUTES = 15; // a webhook still unprocessed by then is listed

export type FailedMessage = { id: string; tenantId: string; academyName: string; templateKey: TemplateKey; toPhone: string; error: string | null; attempts: number; createdAt: Date };
export type WebhookProblem = { id: string; tenantId: string; academyName: string; provider: "razorpay" | "whatsapp"; event: string; receivedAt: Date; processedAt: Date | null; error: string | null };
export type JobQueue = { name: string; queued: number; active: number; failed: number; lastRun: Date | null };
export type QueuesOverview = { messages: FailedMessage[]; webhooks: WebhookProblem[]; jobs: JobQueue[] };

// tenantIds: only for tests, which share the database.
export async function queuesOverview(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<QueuesOverview> {
  const stuck = new Date((opts.now ?? new Date()).getTime() - STUCK_MINUTES * 60_000);
  const { messages, webhooks } = await platformRead(async (tx) => ({
    messages: await tx
      .select({ id: messageLog.id, tenantId: messageLog.tenantId, academyName: tenants.name, templateKey: messageLog.templateKey, toPhone: messageLog.toPhone, error: messageLog.error, attempts: messageLog.attempts, createdAt: messageLog.createdAt })
      .from(messageLog)
      .innerJoin(tenants, eq(tenants.id, messageLog.tenantId))
      .where(and(eq(messageLog.status, "failed"), opts.tenantIds ? inArray(messageLog.tenantId, opts.tenantIds) : undefined))
      .orderBy(desc(messageLog.createdAt))
      .limit(LIMIT),
    webhooks: await tx
      .select({ id: webhookEvents.id, tenantId: webhookEvents.tenantId, academyName: tenants.name, provider: webhookEvents.provider, event: webhookEvents.event, receivedAt: webhookEvents.receivedAt, processedAt: webhookEvents.processedAt, error: webhookEvents.error })
      .from(webhookEvents)
      .innerJoin(tenants, eq(tenants.id, webhookEvents.tenantId))
      .where(and(or(isNotNull(webhookEvents.error), and(isNull(webhookEvents.processedAt), lt(webhookEvents.receivedAt, stuck))), opts.tenantIds ? inArray(webhookEvents.tenantId, opts.tenantIds) : undefined))
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(LIMIT),
  }));
  return { messages, webhooks, jobs: await jobQueues() };
}

// Each of our pg-boss queues (not pg-boss's own): jobs by state and the last
// finished one, through the app's connection (migration 0009's grants).
async function jobQueues(): Promise<JobQueue[]> {
  const rows = await db.execute<{ name: string; queued: string; active: string; failed: string; last_run: string | null }>(sql`
    SELECT q.name,
           count(j.id) FILTER (WHERE j.state IN ('created', 'retry')) AS queued,
           count(j.id) FILTER (WHERE j.state = 'active') AS active,
           count(j.id) FILTER (WHERE j.state = 'failed') AS failed,
           max(j.completed_on) FILTER (WHERE j.state = 'completed') AS last_run
      FROM pgboss.queue q
      LEFT JOIN pgboss.job j ON j.name = q.name
     WHERE q.name NOT LIKE '\_\_pgboss\_\_%'
     GROUP BY q.name
     ORDER BY q.name`);
  return rows.map((r) => ({ name: r.name, queued: Number(r.queued), active: Number(r.active), failed: Number(r.failed), lastRun: r.last_run ? new Date(r.last_run) : null }));
}

// The academy's own Retry, from /platform, with your audit row.
export async function retryMessage(actor: Pick<AuditEntry, "actorType" | "actorId">, id: string): Promise<void> {
  await withPlatformAdmin({ ...actor, action: "message.retry", entityType: "message", entityId: id }, async (tx, audit) => {
    const m = await getMessage(tx, id);
    if (!m) throw new NotFoundError("Message");
    audit.tenantId = m.tenantId;
    await requeue(tx, m);
  });
}
