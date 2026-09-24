"use client";

import { useState } from "react";
import { Field, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { send } from "@/lib/send";

// docs/04 GST and the mid-cycle rule (agreed 2026-09-24).
export function FeeSettings({ gstin, proration }: { gstin: string | null; proration: "full" | "daily" }) {
  const a = useAction();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex max-w-md flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setSaved(false);
        void a.run(
          () => send("/api/settings/fees", "PATCH", { gstin: String(f.get("gstin") ?? "").trim() || null, proration: f.get("proration") }),
          () => {
            setSaved(true);
            a.router.refresh();
          },
        );
      }}
    >
      <Field label="GSTIN (if registered)" id="gstin">
        <Input id="gstin" name="gstin" defaultValue={gstin ?? ""} placeholder="27ABCDE1234F1Z5" autoComplete="off" className="uppercase" />
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1.5 text-label">Joining mid-cycle pays</legend>
        {(
          [
            ["full", "The full cycle"],
            ["daily", "Only the days left"],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className="flex min-h-12 items-center gap-3 text-body">
            <input type="radio" name="proration" value={v} defaultChecked={proration === v} className="size-5 accent-accent-600" />
            {l}
          </label>
        ))}
      </fieldset>
      {a.error ? (
        <p role="alert" className="text-label text-danger-600">
          {a.error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={a.busy}>
          {a.busy ? "Saving…" : "Save"}
        </Button>
        {saved ? <span className="text-caption text-success-600">Saved</span> : null}
      </div>
    </form>
  );
}
