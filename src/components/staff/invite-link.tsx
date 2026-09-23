"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// The one-time link, shown once: copy it or open WhatsApp with it filled in.
export function InviteLink({ token, name }: { token: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/invite/${token}`;
  const text = `Hi ${name}, set your password for our academy app here (valid 7 days): ${url}`;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-4">
      <p className="text-label">Send this link to {name}. It works once and expires in 7 days.</p>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-12 rounded-lg border border-input bg-background px-3 text-caption" aria-label="Invite link" />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? "Copied ✓" : "Copy link"}
        </Button>
        <Button variant="outline" nativeButton={false} render={<a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" />}>
          Send on WhatsApp
        </Button>
      </div>
    </div>
  );
}
