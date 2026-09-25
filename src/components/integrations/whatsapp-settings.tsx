import { CopyText } from "@/components/copy-text";
import { Connection } from "./connection";

export type WhatsappView = { connected: boolean; phone: string | null; name: string | null; verifyToken: string | null; lastError: string | null; lastWebhook: string | null };

// The academy's own WhatsApp Business number on Meta's Cloud API (agreed 2026-09-25).
export function WhatsappSettings({ view, webhookUrl }: { view: WhatsappView; webhookUrl: string }) {
  return (
    <Connection
      provider="WhatsApp"
      path="/api/settings/whatsapp"
      fields={[
        { name: "phoneNumberId", label: "Phone number id", numeric: true },
        { name: "accessToken", label: "Access token", secret: true },
        { name: "appSecret", label: "App secret", secret: true },
      ]}
      connected={view.connected}
      summary={
        <>
          Connected · <span className="tabular-nums">{view.phone}</span>
          {view.name ? ` · ${view.name}` : ""}
        </>
      }
      lastError={view.lastError}
      lastSeen={view.lastWebhook ? `Last report from WhatsApp: ${view.lastWebhook}` : "No report from WhatsApp yet"}
      intro="Send reminders and receipts from your own WhatsApp Business number."
    >
      {view.verifyToken ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-label">Callback URL and verify token</span>
          <CopyText text={webhookUrl} />
          <CopyText text={view.verifyToken} />
          <p className="text-caption text-muted-foreground">Meta app → WhatsApp → Configuration → Webhook. Subscribe to messages.</p>
        </div>
      ) : null}
    </Connection>
  );
}
