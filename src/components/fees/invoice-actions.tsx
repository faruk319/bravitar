"use client";

import { useState } from "react";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { request, send } from "@/lib/send";

// Runs tonight's job now for this academy; new charges land in To review.
export function GenerateNow() {
  const a = useAction();
  const [note, setNote] = useState<string>();
  return (
    <div className="flex items-center gap-2">
      {note ? <span className="text-caption text-muted-foreground">{note}</span> : null}
      <Button
        variant="outline"
        disabled={a.busy}
        onClick={() =>
          void a.run(async () => {
            const r = await request<{ invoices: number; lines: number }>("/api/invoices", "POST", { action: "generate" });
            if (r.data) setNote(r.data.lines ? `${r.data.lines} new ${r.data.lines === 1 ? "charge" : "charges"} on ${r.data.invoices} ${r.data.invoices === 1 ? "invoice" : "invoices"}` : "Nothing new to bill");
            return r.error;
          })
        }
      >
        {a.busy ? "Working…" : "Generate now"}
      </Button>
    </div>
  );
}

// Numbers are given on issue, in order; this can't be undone, only voided.
export function IssueInvoices({ ids, count, total }: { ids: string[] | "all"; count: number; total: string }) {
  const a = useAction();
  const many = count !== 1;
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button />}>{ids === "all" ? "Issue all" : "Issue"}</SheetTrigger>
      <SheetForm
        trigger="Issue"
        title={many ? `Issue ${count} invoices?` : "Issue this invoice?"}
        submitLabel={many ? `Issue ${count} invoices` : "Issue invoice"}
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() => send("/api/invoices", "POST", { action: "issue", ids }));
        }}
      >
        <p className="text-body">
          {total} in total. {many ? "Each gets" : "It gets"} its number now.
        </p>
      </SheetForm>
    </Sheet>
  );
}

// Void keeps the number. "Bill it again" drafts the same charges from today's plans and discounts.
// Money already paid on it goes back to the family's advance (docs/03 §6).
export function VoidInvoice({ id, draft, open, paid }: { id: string; draft: boolean; open?: boolean; paid?: string }) {
  const a = useAction(open);
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="ghost" className="text-danger-600" />}>{draft ? "Discard" : "Void"}</SheetTrigger>
      <SheetForm
        trigger={draft ? "Discard" : "Void"}
        title={draft ? "Discard this draft" : "Void this invoice"}
        submitLabel={draft ? "Discard draft" : "Void invoice"}
        variant="destructive"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(() => send(`/api/invoices/${id}`, "POST", { action: "void", reason: String(f.get("reason") ?? "").trim(), rebill: f.get("rebill") === "on" }));
        }}
      >
        {paid ? <p className="text-body">{paid} paid on it goes back to the family&apos;s advance, for their next invoice or a refund.</p> : null}
        <Field label="Reason" id="void-reason">
          <Input id="void-reason" name="reason" required placeholder="e.g. Wrong fee plan" autoComplete="off" />
        </Field>
        <label className="flex min-h-12 items-center gap-3 text-body">
          <input type="checkbox" name="rebill" className="size-5 accent-accent-600" />
          Bill it again with today&apos;s plan and discounts
        </label>
      </SheetForm>
    </Sheet>
  );
}
