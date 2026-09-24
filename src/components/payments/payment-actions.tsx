"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { formatPaise } from "@/lib/money/format";
import { parseRupees } from "@/lib/money/paise";
import { send } from "@/lib/send";

// The browser prints the receipt, or saves it as a PDF; the shell hides itself.
export function PrintReceipt() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer aria-hidden /> Print
    </Button>
  );
}

// Same day only (docs/03 §9): the number stays, the money comes off its invoices.
export function CancelPayment({ id, receiptNumber }: { id: string; receiptNumber: string }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="ghost" className="text-danger-600" />}>Cancel</SheetTrigger>
      <SheetForm
        trigger="Cancel"
        title={`Cancel ${receiptNumber}`}
        submitLabel="Cancel payment"
        variant="destructive"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(() => send(`/api/payments/${id}/cancel`, "POST", { reason: String(f.get("reason") ?? "").trim() }));
        }}
      >
        <p className="text-body">The receipt number stays and shows as cancelled on today&apos;s sheet. Record the payment again if it was a typing mistake.</p>
        <Field label="Reason" id="cancel-reason">
          <Input id="cancel-reason" name="reason" required placeholder="e.g. Wrong family" autoComplete="off" />
        </Field>
      </SheetForm>
    </Sheet>
  );
}

// Out of the unused advance first, then an invoice, which reopens. The receipt stays as it was.
export function RefundPayment({ id, left, invoices }: { id: string; left: string; invoices: { id: string; label: string }[] }) {
  const a = useAction();
  const [error, setError] = useState<string>();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Refund</SheetTrigger>
      <SheetForm
        trigger="Refund"
        title="Refund"
        submitLabel="Record refund"
        busy={a.busy}
        error={error ?? a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const paise = parseRupees(String(f.get("amount") ?? ""));
          if (!paise) return setError("Enter the amount");
          setError(undefined);
          const invoiceId = String(f.get("invoiceId") ?? "");
          void a.run(() =>
            send(`/api/payments/${id}/refund`, "POST", {
              amountPaise: String(paise),
              method: String(f.get("method") ?? "cash"),
              reason: String(f.get("reason") ?? "").trim(),
              ...(String(f.get("reference") ?? "").trim() ? { reference: String(f.get("reference")).trim() } : {}),
              ...(invoiceId ? { invoiceId } : {}),
            }),
          );
        }}
      >
        <p className="text-body">Up to {formatPaise(BigInt(left))} can be refunded.</p>
        <Field label="Amount" id="refund-amount">
          <Input id="refund-amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0" />
        </Field>
        <Field label="Paid back by" id="refund-method">
          <select id="refund-method" name="method" defaultValue="cash" className={selectClass}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </Field>
        <Field label="Reference (optional)" id="refund-reference">
          <Input id="refund-reference" name="reference" autoComplete="off" />
        </Field>
        {invoices.length ? (
          <Field label="After any advance, take it off" id="refund-invoice">
            <select id="refund-invoice" name="invoiceId" defaultValue="" className={selectClass}>
              <option value="">The latest invoice first</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Reason" id="refund-reason">
          <Input id="refund-reason" name="reason" required placeholder="e.g. Class cancelled" autoComplete="off" />
        </Field>
      </SheetForm>
    </Sheet>
  );
}
