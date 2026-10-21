"use client";

import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { addDays } from "@/lib/dates";
import { send } from "@/lib/send";

// A later expiry for a session pack, always with a reason.
export function ExtendPack({ id, validUntil }: { id: string; validUntil: string }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>Extend</SheetTrigger>
      <SheetForm
        trigger="Extend"
        title="Extend the pack"
        submitLabel="Extend"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(() => send(`/api/session-packs/${id}`, "PATCH", { until: String(f.get("until") ?? ""), reason: String(f.get("reason") ?? "").trim() }));
        }}
      >
        <Field label="New expiry" id="extend-until">
          <Input id="extend-until" name="until" type="date" required min={addDays(validUntil, 1)} defaultValue={addDays(validUntil, 1)} />
        </Field>
        <Field label="Reason" id="extend-reason">
          <Input id="extend-reason" name="reason" required placeholder="e.g. Was ill" autoComplete="off" />
        </Field>
      </SheetForm>
    </Sheet>
  );
}
