"use client";

import { useState } from "react";
import { useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { send } from "@/lib/send";

// Ends a module when its paid period (or trial) runs out, or undoes that. One
// waiting for its first payment is removed at once, after a second tap.
export function CancelButton({ path, cancelling, waiting, size }: { path: string; cancelling: boolean; waiting: boolean; size?: "lg" }) {
  const a = useAction();
  const [confirm, setConfirm] = useState(false);
  const label = waiting ? (confirm ? "Tap again to remove" : "Remove") : cancelling ? "Keep it on" : "Cancel at period end";
  return (
    <>
      <Button
        variant={waiting ? "destructive" : "outline"}
        size={size ?? "default"}
        disabled={a.busy}
        onClick={() => {
          if (waiting && !confirm) return setConfirm(true);
          void a.run(() => send(path, "PATCH", { cancelAtPeriodEnd: waiting || !cancelling }));
        }}
      >
        {label}
      </Button>
      {a.error ? (
        <p role="alert" className="text-label text-danger-600">
          {a.error}
        </p>
      ) : null}
    </>
  );
}
