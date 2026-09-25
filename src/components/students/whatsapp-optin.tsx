"use client";

import { useAction } from "@/components/sheet-form";
import { send } from "@/lib/send";

// docs/03 §10 (agreed 2026-09-25): automated WhatsApp only after the guardian says yes.
export function WhatsappOptin({ guardianId, on, canUpdate }: { guardianId: string; on: boolean; canUpdate: boolean }) {
  const a = useAction();
  if (!canUpdate) return <span className="text-caption text-muted-foreground">{on ? "WhatsApp ✓" : "No WhatsApp"}</span>;
  return (
    <label className="flex min-h-10 items-center gap-2 text-caption text-muted-foreground">
      <input
        type="checkbox"
        checked={on}
        disabled={a.busy}
        onChange={(e) => void a.run(() => send(`/api/guardians/${guardianId}`, "PATCH", { whatsappOptin: e.target.checked }))}
        className="size-5 accent-accent-600"
      />
      WhatsApp
      {a.error ? <span className="text-danger-600">{a.error}</span> : null}
    </label>
  );
}
