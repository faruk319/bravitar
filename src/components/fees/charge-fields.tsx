"use client";

import { Field } from "@/components/sheet-form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const KINDS = [
  ["admission", "Admission"],
  ["exam", "Exam"],
  ["item", "Uniform & kit"],
  ["other", "Other"],
] as const;
export type Kind = (typeof KINDS)[number][0];
export type ChargeInput = { kind: Kind; description: string; amount: string; enrollmentId: string };

// One charge added by hand: kind, what for, amount and program. Create invoice and the collect drawer share it.
export function ChargeFields({ id, value, enrollments, onChange }: { id: string; value: ChargeInput; enrollments: { id: string; programName: string; batchName: string }[]; onChange: (patch: Partial<ChargeInput>) => void }) {
  return (
    <>
      <div role="group" aria-label="Kind" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {KINDS.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            aria-pressed={value.kind === kind}
            onClick={() => onChange({ kind })}
            className={cn("h-12 rounded-full border px-1 text-label", value.kind === kind ? "border-accent-600 bg-accent-50 text-accent-600" : "border-neutral-300 text-neutral-700")}
          >
            {label}
          </button>
        ))}
      </div>
      <Field label="What for" id={`charge-what-${id}`}>
        <Input id={`charge-what-${id}`} autoComplete="off" maxLength={120} value={value.description} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
      <Field label="Amount" id={`charge-amount-${id}`}>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body text-muted-foreground">₹</span>
          <Input id={`charge-amount-${id}`} inputMode="decimal" autoComplete="off" className="pl-7 text-number tabular-nums" value={value.amount} onChange={(e) => onChange({ amount: e.target.value })} />
        </div>
      </Field>
      {enrollments.length ? (
        <Field label="Program (optional)" id={`charge-program-${id}`}>
          <select id={`charge-program-${id}`} value={value.enrollmentId} onChange={(e) => onChange({ enrollmentId: e.target.value })} className="h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base">
            <option value="">No program</option>
            {enrollments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.programName} · {e.batchName}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </>
  );
}
