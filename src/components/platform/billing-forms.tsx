"use client";

import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { uuidv7 } from "@/lib/ids";
import { parseRupees } from "@/lib/money/paise";
import { send } from "@/lib/send";

const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim();

// A payment to Bravitar for one branch module (agreed 2026-09-30). A new
// request id each time the sheet opens, so a double click is one payment.
export function RecordPayment({ subscriptionId, title, hint, due, today, methods }: { subscriptionId: string; title: string; hint: string; due: string; today: string; methods: { value: string; label: string }[] }) {
  const a = useAction();
  const [requestId, setRequestId] = useState(() => uuidv7());
  const [error, setError] = useState<string>();
  const id = (f: string) => `${subscriptionId}-${f}`;
  return (
    <Sheet
      open={a.open}
      onOpenChange={(open) => {
        if (open) setRequestId(uuidv7());
        a.setOpen(open);
      }}
    >
      <SheetTrigger render={<Button variant="outline" size="lg" />}>Record payment</SheetTrigger>
      <SheetForm
        trigger="Record payment"
        title={title}
        submitLabel="Record payment"
        busy={a.busy}
        error={error ?? a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const paise = parseRupees(text(f, "amount"));
          if (!paise) return setError("Enter the amount");
          setError(undefined);
          const optional = Object.fromEntries(["reference", "note"].filter((k) => text(f, k)).map((k) => [k, text(f, k)]));
          void a.run(() =>
            send(`/api/platform/subscriptions/${subscriptionId}/payments`, "POST", { requestId, amountPaise: String(paise), method: text(f, "method"), receivedOn: text(f, "receivedOn"), ...optional }),
          );
        }}
      >
        <p className="text-body text-muted-foreground">{hint}</p>
        <Field label="Amount ₹" id={id("amount")}>
          <Input id={id("amount")} name="amount" inputMode="decimal" defaultValue={due} />
        </Field>
        <Field label="Method" id={id("method")}>
          <select id={id("method")} name="method" defaultValue="upi" className={selectClass}>
            {methods.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference" id={id("reference")}>
          <Input id={id("reference")} name="reference" placeholder="UTR or cheque number" autoComplete="off" />
        </Field>
        <Field label="Received on" id={id("received")}>
          <Input id={id("received")} name="receivedOn" type="date" defaultValue={today} max={today} />
        </Field>
        <Field label="Note" id={id("note")}>
          <Input id={id("note")} name="note" autoComplete="off" />
        </Field>
      </SheetForm>
    </Sheet>
  );
}
