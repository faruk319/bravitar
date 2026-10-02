import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { webhookEvents } from "@/modules/integrations/schema";
import { getMessage, insertMessage } from "@/modules/messaging/repo";
import { queuesOverview, retryMessage } from "./queues";

// Prompt 21: /platform/queues, across academies.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const NOW = new Date();
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
let A = "";
let B = "";
const failed: Record<string, string> = {};

const academy = async (slug: string) => (await testAcademy({ name: `Queues ${slug}`, slug: `queues-${slug}-${stamp}`, verticalPreset: "tuition", owner: { name: "Owner", email: `queues-${slug}-${stamp}@example.test` } })).tenant.id;
const failMessage = (tenantId: string) =>
  withTenant(tenantId, (tx) =>
    insertMessage(tx, { tenantId, toPhone: "+919800012345", channel: "whatsapp", templateKey: "fee_due", category: "fees", language: "en", body: "Fees are due", status: "failed", error: "Number not on WhatsApp", attempts: 1 }),
  );
const webhook = (event: string, receivedAt: Date, more: { processedAt?: Date; error?: string } = {}) =>
  withTenant(A, (tx) => tx.insert(webhookEvents).values({ tenantId: A, provider: "razorpay", providerEventId: `${event}-${stamp}`, event, payload: {}, receivedAt, ...more }));

beforeAll(async () => {
  [A, B] = [await academy("a"), await academy("b")];
  for (const t of [A, B]) failed[t] = (await failMessage(t))?.id ?? "";
  await webhook("payment.failed-to-apply", minutesAgo(30), { processedAt: minutesAgo(30), error: "No such invoice" });
  await webhook("payment.stuck", minutesAgo(20));
  await webhook("payment.just-in", minutesAgo(2));
  await webhook("payment.fine", minutesAgo(40), { processedAt: minutesAgo(40) });
});

afterAll(async () => {
  await deleteTenantsCompletely([A, B].filter(Boolean));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the queues page", () => {
  it("lists every academy's failed messages, the webhooks that failed or stuck past 15 minutes, and the job queues", async () => {
    const q = await queuesOverview({ now: NOW, tenantIds: [A, B] });
    expect(q.messages.map((m) => m.id).sort()).toEqual([failed[A], failed[B]].sort());
    expect(q.messages[0]).toMatchObject({ templateKey: "fee_due", error: "Number not on WhatsApp", attempts: 1 });
    expect(q.webhooks.map((w) => w.event).sort()).toEqual(["payment.failed-to-apply", "payment.stuck"]);
    for (const j of q.jobs) expect(j).toMatchObject({ name: expect.any(String), queued: expect.any(Number), active: expect.any(Number), failed: expect.any(Number) });
  });

  it("Retry puts one message back in its academy's queue, audited there; the other academy's stays failed", async () => {
    await retryMessage(ME, failed[A] ?? "");
    const [mine, other] = [await withTenant(A, (tx) => getMessage(tx, failed[A] ?? "")), await withTenant(B, (tx) => getMessage(tx, failed[B] ?? ""))];
    expect(mine).toMatchObject({ status: "queued", error: null });
    expect(other).toMatchObject({ status: "failed" });
    const rows = await withTenant(A, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "message.retry")));
    expect(rows).toMatchObject([{ actorType: "platform", entityId: failed[A] }]);
    await expect(retryMessage(ME, failed[A] ?? "")).rejects.toThrow("Only a failed message can be tried again");
    expect((await queuesOverview({ now: NOW, tenantIds: [A, B] })).messages.map((m) => m.id)).toEqual([failed[B]]);
  });
});
