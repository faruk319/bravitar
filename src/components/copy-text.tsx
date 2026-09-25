"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A value to copy: a webhook URL, a payment link; `wrap` shows all of a longer text.
export function CopyText({ text, wrap = false }: { text: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("flex gap-2", wrap ? "items-start" : "items-center")}>
      <code className={cn("min-w-0 flex-1 rounded-lg bg-neutral-50 px-3 py-2 text-label", wrap ? "whitespace-pre-wrap break-words" : "truncate")}>{text}</code>
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
