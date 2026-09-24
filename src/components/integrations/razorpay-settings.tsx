"use client";

import { useState } from "react";
import { CopyText } from "@/components/copy-text";
import { Field, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { request } from "@/lib/send";

export type RazorpayView = { connected: boolean; keyId: string | null; mode: "test" | "live" | null; lastError: string | null; lastWebhook: string | null };

const EVENTS = "payment_link.paid, payment.captured, payment.failed, refund.processed";
const masked = (keyId: string) => `${keyId.slice(0, keyId.lastIndexOf("_") + 1)}…${keyId.slice(-4)}`;

// docs/03 §9 (agreed 2026-09-25): the academy's own Razorpay account. Saving
// checks the keys with Razorpay; the secrets are never shown again.
export function RazorpaySettings({ view, webhookUrl }: { view: RazorpayView; webhookUrl: string }) {
  const a = useAction();
  const [editing, setEditing] = useState(!view.connected);
  const [tested, setTested] = useState<string>();

  return (
    <div className="flex max-w-md flex-col gap-4">
      {view.connected && view.keyId ? (
        <div className="flex flex-col gap-1">
          <p className="text-body">
            Connected · {view.mode === "test" ? "Test mode" : "Live"} · <span className="tabular-nums">{masked(view.keyId)}</span>
          </p>
          {view.lastError ? (
            <p role="alert" className="text-label text-danger-600">
              {view.lastError}
            </p>
          ) : tested ? (
            <p className="text-label text-success-600">{tested}</p>
          ) : null}
          <p className="text-caption text-muted-foreground">{view.lastWebhook ? `Last webhook from Razorpay: ${view.lastWebhook}` : "No webhook from Razorpay yet"}</p>
        </div>
      ) : (
        <p className="text-body text-muted-foreground">Parents pay invoices online through your own Razorpay account; the money goes straight to your bank.</p>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-label">Webhook URL for Razorpay</span>
        <CopyText text={webhookUrl} />
        <p className="text-caption text-muted-foreground">
          In Razorpay: Settings → Webhooks → Add. Paste this URL, choose a secret (the same one goes below), and tick {EVENTS}.
        </p>
      </div>

      {editing ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body = { keyId: String(f.get("keyId") ?? ""), keySecret: String(f.get("keySecret") ?? ""), webhookSecret: String(f.get("webhookSecret") ?? "") };
            void a.run(
              async () => (await request("/api/settings/razorpay", "POST", body)).error,
              () => {
                setEditing(false);
                setTested("Keys work");
                a.router.refresh();
              },
            );
          }}
        >
          <Field label="Key id" id="rzp-key-id">
            <Input id="rzp-key-id" name="keyId" placeholder="rzp_live_…" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Key secret" id="rzp-key-secret">
            <Input id="rzp-key-secret" name="keySecret" type="password" autoComplete="off" />
          </Field>
          <Field label="Webhook secret" id="rzp-webhook-secret">
            <Input id="rzp-webhook-secret" name="webhookSecret" type="password" autoComplete="off" />
          </Field>
          {a.error ? (
            <p role="alert" className="text-label text-danger-600">
              {a.error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={a.busy}>
              {a.busy ? "Checking with Razorpay…" : "Test and save"}
            </Button>
            {view.connected ? (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Keep current keys
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={a.busy}
            onClick={() =>
              void a.run(
                async () => {
                  const r = await request<{ lastError: string | null }>("/api/settings/razorpay/test", "POST");
                  if (r.data) setTested(r.data.lastError ? undefined : "Keys work");
                  return r.error;
                },
                () => a.router.refresh(),
              )
            }
          >
            {a.busy ? "Testing…" : "Test connection"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Change keys
          </Button>
          {a.error ? (
            <p role="alert" className="text-label text-danger-600">
              {a.error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
