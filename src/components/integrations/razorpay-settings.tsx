import { CopyText } from "@/components/copy-text";
import { Connection } from "./connection";

export type RazorpayView = { connected: boolean; keyId: string | null; mode: "test" | "live" | null; lastError: string | null; lastWebhook: string | null };

const EVENTS = "payment_link.paid, payment.captured, payment.failed, refund.processed";
const masked = (keyId: string) => `${keyId.slice(0, keyId.lastIndexOf("_") + 1)}…${keyId.slice(-4)}`;

// docs/03 §9 (agreed 2026-09-25): the academy's own Razorpay account.
export function RazorpaySettings({ view, webhookUrl }: { view: RazorpayView; webhookUrl: string }) {
  return (
    <Connection
      provider="Razorpay"
      path="/api/settings/razorpay"
      fields={[
        { name: "keyId", label: "Key id", placeholder: "rzp_live_…" },
        { name: "keySecret", label: "Key secret", secret: true },
        { name: "webhookSecret", label: "Webhook secret", secret: true },
      ]}
      connected={view.connected}
      summary={
        <>
          Connected · {view.mode === "test" ? "Test mode" : "Live"} · <span className="tabular-nums">{masked(view.keyId ?? "")}</span>
        </>
      }
      lastError={view.lastError}
      lastSeen={view.lastWebhook ? `Last webhook from Razorpay: ${view.lastWebhook}` : "No webhook from Razorpay yet"}
      intro="Parents pay invoices online through your own Razorpay account; the money goes straight to your bank."
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-label">Webhook URL for Razorpay</span>
        <CopyText text={webhookUrl} />
        <p className="text-caption text-muted-foreground">
          In Razorpay: Settings → Webhooks → Add. Paste this URL, choose a secret (the same one goes below), and tick {EVENTS}.
        </p>
      </div>
    </Connection>
  );
}
