import { EmptyState } from "@/components/empty-state";
import { RetryMessage, ToSendActions } from "@/components/messaging/message-actions";
import { TemplateEditor } from "@/components/messaging/template-editor";
import { PageHeader } from "@/components/page-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate, timeIn } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { MessageRow } from "@/modules/messaging/repo";
import type { MessageStatus } from "@/modules/messaging/schema";
import { LOG_VIEWS, type LogView, messageLogView, messageTemplates } from "@/modules/messaging/service";
import { TEMPLATE_LABELS } from "@/modules/messaging/templates";

const TABS: Record<LogView | "templates", string> = { to_send: "To send", sent: "Sent", failed: "Failed", templates: "Templates" };
const EMPTY: Record<LogView, string> = { to_send: "Nothing to send", sent: "Nothing sent yet", failed: "Nothing failed" };
const STATUS: Partial<Record<MessageStatus, [string, string]>> = {
  sent: ["Sent", "bg-accent-50 text-accent-600"],
  delivered: ["Delivered", "bg-success-600/10 text-success-600"],
  read: ["Read", "bg-success-600/10 text-success-600"],
  skipped: ["Skipped", "bg-neutral-100 text-neutral-500"],
};

function Row({ m, tz, children }: { m: MessageRow; tz: string; children?: React.ReactNode }) {
  const [word, cls] = STATUS[m.status] ?? ["", ""];
  return (
    <li className="flex flex-col gap-2 px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-medium">
          {m.guardianName ?? formatPhone(m.toPhone)} <span className="text-caption font-normal text-muted-foreground">· {TEMPLATE_LABELS[m.templateKey]}</span>
        </span>
        <span className="flex items-center gap-2 text-caption text-muted-foreground">
          {word ? <span className={cn("rounded-full px-2 py-0.5 text-label", cls)}>{word}</span> : null}
          {m.channel === "manual" && m.status !== "queued" ? "by hand · " : ""}
          {formatDate(m.createdAt)}, {timeIn(tz, m.createdAt)}
        </span>
      </div>
      <p className="line-clamp-2 text-caption text-muted-foreground">{m.body}</p>
      {m.error ? <p className="text-label text-danger-600">{m.error}</p> : null}
      {children}
    </li>
  );
}

// docs/03 §10: every automated message, and the ones waiting to be sent by hand.
export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "messages:read")) return <Gate permission="messages:read">{null}</Gate>;
  const canManage = allows(ctx, "messages:manage");
  const canSend = allows(ctx, "messages:send");
  const asked = (await searchParams).view;
  const view: LogView | "templates" = asked === "templates" && canManage ? "templates" : (LOG_VIEWS.find((v) => v === asked) ?? "to_send");
  const data = await withTenant(session.tenant.id, async (tx) => ({
    log: view === "templates" ? undefined : await messageLogView(tx, ctx, view),
    templates: view === "templates" ? await messageTemplates(tx, ctx) : [],
  }));
  const tabs = (["to_send", "sent", "failed", ...(canManage ? (["templates"] as const) : [])] as const).map((v) => ({
    href: `/messages?view=${v}`,
    label: v === "to_send" && data.log?.toSend ? `${TABS[v]} · ${data.log.toSend}` : TABS[v],
    active: v === view,
  }));

  return (
    <Gate permission="messages:read">
      <PageHeader title="Messages">
        <p className="text-caption text-muted-foreground">WhatsApp isn&apos;t connected: automated messages wait under To send.</p>
      </PageHeader>
      <SegmentedTabs label="Messages" items={tabs} />
      {view === "templates" ? (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {data.templates.map((t) => (
            <TemplateEditor key={`${t.key}-${t.body}-${t.isActive}`} t={t} />
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden p-0 md:p-0">
          {data.log?.messages.length ? (
            <ul className="divide-y divide-neutral-100">
              {data.log.messages.map((m) => (
                <Row key={m.id} m={m} tz={session.tenant.timezone}>
                  {canSend && view === "to_send" ? <ToSendActions id={m.id} phone={m.toPhone} body={m.body} /> : null}
                  {canSend && view === "failed" ? <RetryMessage id={m.id} /> : null}
                </Row>
              ))}
            </ul>
          ) : (
            <EmptyState title={EMPTY[view]} hint="Fee reminders, receipts and absence messages show here." />
          )}
        </Card>
      )}
    </Gate>
  );
}
