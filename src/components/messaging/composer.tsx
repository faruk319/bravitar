"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatPhone } from "@/lib/phone";
import { request } from "@/lib/send";
import type { ComposeRequest, Composed, Draft } from "@/modules/messaging/compose";
import { TEMPLATE_LABELS } from "@/modules/messaging/templates";

const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

// docs/06 Prompt 17 step 1: the message from its template, to copy or open in
// WhatsApp on this phone. Works with no WhatsApp account connected.
export function Composer({ request: req, label, variant = "outline", size = "default" }: { request: ComposeRequest; label: string; variant?: "outline" | "ghost"; size?: "default" | "sm" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [drafts, setDrafts] = useState<Draft[]>([]);

  async function load() {
    setBusy(true);
    setError(undefined);
    setDrafts([]);
    const r = await request<Composed>("/api/messages/compose", "POST", req);
    setBusy(false);
    if (r.data) setDrafts(r.data.drafts);
    else setError(r.offline ? "No connection. Try again." : r.error);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <SheetTrigger render={<Button variant={variant} size={size} />}>{label}</SheetTrigger>
      <SheetContent side="auto" className="max-h-[90dvh] overflow-y-auto">
        <SheetTitle className="text-heading">{TEMPLATE_LABELS[req.key]}</SheetTitle>
        <div className="mt-4 flex max-w-md flex-col gap-6" aria-live="polite">
          {busy ? <p className="text-body text-muted-foreground">Writing the message…</p> : null}
          {error ? (
            <p role="alert" className="text-label text-danger-600">
              {error}
            </p>
          ) : null}
          {!busy && !error && !drafts.length ? <p className="text-body text-muted-foreground">No one to message.</p> : null}
          {drafts.map((d, i) => (
            <DraftCard key={`${d.about}-${i}`} draft={d} many={drafts.length > 1} onChange={(text) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, text } : x)))} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DraftCard({ draft, many, onChange }: { draft: Draft; many: boolean; onChange: (text: string) => void }) {
  const [to, setTo] = useState(0);
  const [copied, setCopied] = useState(false);
  const who = draft.to[to];
  return (
    <div className="flex flex-col gap-2">
      {many ? <p className="text-label">{draft.about}</p> : null}
      {draft.to.length > 1 ? (
        <select aria-label="Send to" value={to} onChange={(e) => setTo(Number(e.target.value))} className="h-12 rounded-lg border border-border bg-background px-3 text-body">
          {draft.to.map((r, i) => (
            <option key={r.phone} value={i}>
              {r.name} · {formatPhone(r.phone)}
            </option>
          ))}
        </select>
      ) : who ? (
        <p className="text-caption text-muted-foreground">
          To {who.name} · {formatPhone(who.phone)}
        </p>
      ) : (
        <p className="text-caption text-muted-foreground">No phone saved: copy the text and send it yourself.</p>
      )}
      <textarea aria-label="Message" value={draft.text} onChange={(e) => onChange(e.target.value)} rows={6} className="rounded-lg border border-border bg-background px-3 py-2 text-body" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(draft.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        {who ? (
          <Button nativeButton={false} render={<a href={waLink(who.phone, draft.text)} target="_blank" rel="noreferrer" />}>
            Open WhatsApp
          </Button>
        ) : null}
      </div>
    </div>
  );
}
