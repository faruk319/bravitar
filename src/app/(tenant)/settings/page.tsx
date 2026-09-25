import { FeeSettings } from "@/components/fees/fee-settings";
import { RazorpaySettings } from "@/components/integrations/razorpay-settings";
import { WhatsappSettings } from "@/components/integrations/whatsapp-settings";
import { MessagingSettings } from "@/components/messaging/messaging-settings";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Placeholder } from "@/components/shell/placeholder";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { formatDate, timeIn } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { tenantOrigin } from "@/lib/tenant/origin";
import { razorpayStatus, whatsappStatus } from "@/modules/integrations/service";
import { messagingSettings } from "@/modules/messaging/service";
import { getOwnTenant } from "@/modules/tenancy/repo";

// Each card follows its own permission: settings, the Razorpay and WhatsApp connections (owner by default), messages.
export default async function SettingsPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const [settings, integrations, messaging] = [allows(ctx, "settings:manage"), allows(ctx, "integrations:manage"), allows(ctx, "messages:manage")];
  if (!settings && !integrations && !messaging) return <Gate permission="settings:manage">{null}</Gate>;
  const { tenant, razorpay, whatsapp, messages } = await withTenant(session.tenant.id, async (tx) => ({
    tenant: await getOwnTenant(tx),
    razorpay: integrations && ctx.modules.fees ? await razorpayStatus(tx, ctx) : undefined,
    whatsapp: integrations ? await whatsappStatus(tx, ctx) : undefined,
    messages: messaging ? await messagingSettings(tx, ctx) : undefined,
  }));
  const webhookUrl = (provider: string) => `${tenantOrigin(session.tenant.slug)}/api/webhooks/${provider}/${session.tenant.slug}`;
  const tz = session.tenant.timezone;
  const seen = (at: Date | null) => (at ? `${formatDate(at)}, ${timeIn(tz, at)}` : null);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {settings && ctx.modules.fees ? (
          <Card>
            <CardHeader title="Fees" />
            <FeeSettings gstin={tenant?.gstin ?? null} proration={tenant?.proration ?? "full"} />
          </Card>
        ) : null}
        {razorpay ? (
          <Card>
            <CardHeader title="Razorpay" />
            <RazorpaySettings
              webhookUrl={webhookUrl("razorpay")}
              view={{ connected: razorpay.connected, keyId: razorpay.keyId, mode: razorpay.mode, lastError: razorpay.lastError, lastWebhook: seen(razorpay.lastWebhookAt) }}
            />
          </Card>
        ) : null}
        {whatsapp ? (
          <Card>
            <CardHeader title="WhatsApp" />
            <WhatsappSettings webhookUrl={webhookUrl("whatsapp")} view={{ ...whatsapp, lastWebhook: seen(whatsapp.lastWebhookAt) }} />
          </Card>
        ) : null}
        {messages ? (
          <Card>
            <CardHeader title="Messages" />
            <MessagingSettings settings={messages} />
          </Card>
        ) : null}
        {settings ? <Placeholder title="Academy settings" hint="Name, branches, labels and integrations." action="Edit academy" /> : null}
      </div>
    </>
  );
}
