"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// A value to copy: a webhook URL, a payment link.
export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-neutral-50 px-3 py-2 text-label">{text}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
