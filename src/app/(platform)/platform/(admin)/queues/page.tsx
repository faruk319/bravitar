import { RetryMessage } from "@/components/messaging/message-actions";
import { AcademyLink, Section } from "@/components/platform/sections";
import { requirePlatformPage } from "@/lib/auth/server";
import { formatDate, timeIn } from "@/lib/dates";
import { TEMPLATE_LABELS } from "@/modules/messaging/templates";
import { queuesOverview } from "@/modules/platform/queues";

const when = (at: Date) => `${formatDate(at)} ${timeIn("Asia/Kolkata", at)}`;
const PROVIDER = { razorpay: "Razorpay", whatsapp: "WhatsApp" } as const;

// What went wrong across academies (Prompt 21): failed WhatsApp messages with
// Retry, webhooks that failed or were never processed, and the job queue.
export default async function QueuesPage() {
  await requirePlatformPage();
  const q = await queuesOverview();
  return (
    <>
      <h1 className="mb-4 text-display">Queues</h1>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="Failed messages" empty={!q.messages.length}>
          {q.messages.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-3">
              <span className="text-body">
                <AcademyLink id={m.tenantId} name={m.academyName} /> · {TEMPLATE_LABELS[m.templateKey]}
                <span className="block text-caption text-muted-foreground">
                  {m.toPhone} · {m.attempts} {m.attempts === 1 ? "try" : "tries"} · {when(m.createdAt)}
                </span>
                {m.error ? <span className="block text-caption text-danger-600">{m.error}</span> : null}
              </span>
              <RetryMessage id={m.id} base="/api/platform/messages" />
            </li>
          ))}
        </Section>
        <Section title="Webhooks" empty={!q.webhooks.length}>
          {q.webhooks.map((w) => (
            <li key={w.id} className="py-3 text-body">
              <AcademyLink id={w.tenantId} name={w.academyName} /> · {PROVIDER[w.provider]} {w.event}
              <span className="block text-caption text-muted-foreground">
                {when(w.receivedAt)} · {w.processedAt ? "processed" : "not processed"}
              </span>
              {w.error ? <span className="block text-caption text-danger-600">{w.error}</span> : null}
            </li>
          ))}
        </Section>
        <Section title="Jobs" empty={!q.jobs.length}>
          {q.jobs.map((j) => (
            <li key={j.name} className="flex items-start justify-between gap-3 py-3">
              <span className="text-body">
                {j.name}
                <span className="block text-caption text-muted-foreground">Last run {j.lastRun ? when(j.lastRun) : "never"}</span>
              </span>
              <span className="shrink-0 text-right text-caption tabular-nums">
                {j.queued} queued · {j.active} active · <span className={j.failed ? "text-danger-600" : undefined}>{j.failed} failed</span>
              </span>
            </li>
          ))}
        </Section>
      </div>
    </>
  );
}
