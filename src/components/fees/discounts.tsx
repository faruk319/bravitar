"use client";

import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { parseRupees } from "@/lib/money/paise";
import { send } from "@/lib/send";

// docs/04: sibling, scholarship or promotional; percent or a fixed amount.
export function AddDiscount() {
  const a = useAction();
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>Add discount</SheetTrigger>
      <SheetForm
        trigger="Add discount"
        title="New discount"
        submitLabel="Save discount"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const raw = String(f.get("value") ?? "").trim();
          const value = kind === "percent" ? Number(raw) : Number(parseRupees(raw) ?? Number.NaN);
          if (!Number.isInteger(value) || value <= 0) {
            void a.run(async () => (kind === "percent" ? "Enter a whole percentage" : "Enter an amount like 200"));
            return;
          }
          void a.run(() => send("/api/discounts", "POST", { name: String(f.get("name") ?? "").trim(), kind, value }));
        }}
      >
        <Field label="Name" id="discount-name">
          <Input id="discount-name" name="name" required placeholder="e.g. Sibling 10%" autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" id="discount-kind">
            <select id="discount-kind" value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} className={selectClass}>
              <option value="percent">Percent</option>
              <option value="amount">Fixed amount</option>
            </select>
          </Field>
          <Field label={kind === "percent" ? "Percent" : "Amount (₹)"} id="discount-value">
            <Input id="discount-value" name="value" inputMode={kind === "percent" ? "numeric" : "decimal"} placeholder={kind === "percent" ? "10" : "200"} />
          </Field>
        </div>
      </SheetForm>
    </Sheet>
  );
}

export function DiscountToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const a = useAction();
  return (
    <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => void a.run(() => send(`/api/discounts/${id}`, "PATCH", { isActive: !isActive }))}>
      {isActive ? "Turn off" : "Turn on"}
    </Button>
  );
}

// Always with a reason: it prints next to the discount on every invoice.
export function GiveDiscount({ studentId, discounts, today }: { studentId: string; discounts: { id: string; label: string }[]; today: string }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>Give discount</SheetTrigger>
      <SheetForm
        trigger="Give discount"
        title="Give a discount"
        submitLabel="Give discount"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const str = (k: string) => String(f.get(k) ?? "").trim();
          void a.run(() => send("/api/student-discounts", "POST", { studentId, discountId: str("discountId"), reason: str("reason"), validFrom: str("validFrom") || undefined, validTo: str("validTo") || null }));
        }}
      >
        <Field label="Discount" id="give-discount">
          <select id="give-discount" name="discountId" className={selectClass}>
            {discounts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason" id="give-reason">
          <Input id="give-reason" name="reason" required placeholder="e.g. Second child in the family" autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" id="give-from">
            <Input id="give-from" name="validFrom" type="date" defaultValue={today} />
          </Field>
          <Field label="Until (optional)" id="give-to">
            <Input id="give-to" name="validTo" type="date" />
          </Field>
        </div>
      </SheetForm>
    </Sheet>
  );
}

export function EndDiscount({ id }: { id: string }) {
  const a = useAction();
  return (
    <Button size="sm" variant="ghost" className="text-danger-600" disabled={a.busy} onClick={() => void a.run(() => send(`/api/student-discounts/${id}`, "DELETE"))}>
      End
    </Button>
  );
}
