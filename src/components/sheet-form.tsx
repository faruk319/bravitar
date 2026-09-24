"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SheetContent, SheetTitle } from "@/components/ui/sheet";

// Bottom sheet with one form; useAction runs a request, shows its error, refreshes on success.
export function SheetForm({ trigger, title, children, onSubmit, submitLabel, busy, error, variant = "outline" }: { trigger: string; title: string; children: ReactNode; onSubmit: (e: FormEvent<HTMLFormElement>) => void; submitLabel: string; busy: boolean; error?: string | undefined; variant?: "outline" | "destructive" }) {
  return (
    <SheetContent side="auto">
      <SheetTitle className="text-heading">{title}</SheetTitle>
      <form onSubmit={onSubmit} className="mt-4 flex max-w-md flex-col gap-4" noValidate>
        {children}
        {error ? (
          <p role="alert" className="text-label text-danger-600">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" variant={variant === "destructive" ? "destructive" : "default"} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </form>
      <span className="sr-only">{trigger}</span>
    </SheetContent>
  );
}

export function useAction(initiallyOpen = false) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (fn: () => Promise<string | undefined>, after?: () => void) => {
    setBusy(true);
    setError(undefined);
    const err = await fn();
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    if (after) after();
    else router.refresh();
  };
  return { open, setOpen, busy, error, run, router };
}

export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
