"use client";

import { useState } from "react";
import { CopyText } from "@/components/copy-text";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatPaise } from "@/lib/money/format";
import { request } from "@/lib/send";

type Share = { url: string; amountPaise: string; invoiceNumber: string; phone: string | null; message: string; reused: boolean };

// docs/03 §9 (agreed 2026-09-25): the invoice's live Razorpay link, made or
// reused on opening. Staff share it; WhatsApp opens with the message filled in.
export function PaymentLink({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<Share>();
  const [error, setError] = useState<string>();

  async function make() {
    setBusy(true);
    setError(undefined);
    const r = await request<Share>(`/api/invoices/${invoiceId}/payment-link`, "POST");
    setBusy(false);
    if (r.data) setLink(r.data);
    else setError(r.offline ? "No connection. Try again." : r.error);
  }

  const whatsapp = link ? `https://wa.me/${link.phone ? link.phone.replace(/\D/g, "") : ""}?text=${encodeURIComponent(link.message)}` : "";
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void make();
      }}
    >
      <SheetTrigger render={<Button variant="outline" />}>Payment link</SheetTrigger>
      <SheetContent side="auto">
        <SheetTitle className="text-heading">Payment link</SheetTitle>
        <div className="mt-4 flex max-w-md flex-col gap-4" aria-live="polite">
          {busy ? <p className="text-body text-muted-foreground">Asking Razorpay for the link…</p> : null}
          {!busy && error ? (
            <p role="alert" className="text-label text-danger-600">
              {error}
            </p>
          ) : null}
          {!busy && link ? (
            <>
              <p className="text-body">
                {formatPaise(BigInt(link.amountPaise))} for {link.invoiceNumber}, paid in full through Razorpay into your account.
              </p>
              <CopyText text={link.url} />
              <Button size="lg" nativeButton={false} render={<a href={whatsapp} target="_blank" rel="noreferrer" />}>
                Share on WhatsApp
              </Button>
              <p className="text-caption text-muted-foreground">
                {link.phone ? "Opens WhatsApp with the message ready for the family's contact." : "No phone saved for the family: WhatsApp will ask who to send it to."} When they pay, the receipt is made here by itself.
              </p>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
