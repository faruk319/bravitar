"use client";

import { useState } from "react";
import { useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { send } from "@/lib/send";

const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

// docs/03 §10 fallback: a person sends it from their own WhatsApp, then marks it.
export function ToSendActions({ id, phone, body }: { id: string; phone: string; body: string }) {
  const a = useAction();
  const [copied, setCopied] = useState(false);
  const act = (action: "sent" | "skip") => void a.run(() => send(`/api/messages/${id}`, "POST", { action }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" nativeButton={false} render={<a href={waLink(phone, body)} target="_blank" rel="noreferrer" />}>
        Open WhatsApp
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void navigator.clipboard.writeText(body).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </Button>
      <Button size="sm" variant="outline" disabled={a.busy} onClick={() => act("sent")}>
        Mark sent
      </Button>
      <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => act("skip")}>
        Skip
      </Button>
      {a.error ? (
        <span role="alert" className="text-label text-danger-600">
          {a.error}
        </span>
      ) : null}
    </div>
  );
}

export function RetryMessage({ id }: { id: string }) {
  const a = useAction();
  return (
    <Button size="sm" variant="outline" disabled={a.busy} onClick={() => void a.run(() => send(`/api/messages/${id}`, "POST", { action: "retry" }))}>
      Retry
    </Button>
  );
}
