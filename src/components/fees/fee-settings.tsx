"use client";

import { useState } from "react";
import { Field, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { send } from "@/lib/send";

function Choice<V extends string>({ legend, name, value, options }: { legend: string; name: string; value: V; options: readonly (readonly [V, string])[] }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1.5 text-label">{legend}</legend>
      {options.map(([v, l]) => (
        <label key={v} className="flex min-h-12 items-center gap-3 text-body">
          <input type="radio" name={name} value={v} defaultChecked={value === v} className="size-5 accent-accent-600" />
          {l}
        </label>
      ))}
    </fieldset>
  );
}

// docs/04 GST and the mid-cycle rule (agreed 2026-09-24); sending is the finance spec's "Auto-issue".
export function FeeSettings({ gstin, proration, invoiceIssue }: { gstin: string | null; proration: "full" | "daily"; invoiceIssue: "review" | "auto" }) {
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
          () => send("/api/settings/fees", "PATCH", { gstin: String(f.get("gstin") ?? "").trim() || null, proration: f.get("proration"), invoiceIssue: f.get("invoiceIssue") }),
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
      <Choice
        legend="Joining mid-cycle pays"
        name="proration"
        value={proration}
        options={[
          ["full", "The full cycle"],
          ["daily", "Only the days left"],
        ]}
      />
      <Choice
        legend="Send invoices"
        name="invoiceIssue"
        value={invoiceIssue}
        options={[
          ["review", "After I review"],
          ["auto", "Automatically"],
        ]}
      />
      {a.error ? (
        <p role="alert" className="text-label text-danger-700">
          {a.error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={a.busy}>
          {a.busy ? "Saving…" : "Save"}
        </Button>
        {saved ? <span className="text-caption text-success-700">Saved</span> : null}
      </div>
    </form>
  );
}
