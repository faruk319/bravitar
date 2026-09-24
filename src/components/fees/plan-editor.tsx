"use client";

import { Plus, X } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { formatPaise } from "@/lib/money/format";
import { parseRupees, sum } from "@/lib/money/paise";
import { send } from "@/lib/send";
import type { Installment } from "@/modules/fees/schema";

export const selectClass = "h-12 rounded-lg border border-border bg-background px-3 text-body";

// Paise travel as digit strings; inputs show plain rupees ("1,500.50").
export const rupeesInput = (paise: string | number) => (String(paise) === "0" ? "" : formatPaise(BigInt(paise)).slice(1));

export type PlanForm = {
  id: string;
  name: string;
  programId: string | null;
  kind: "recurring" | "term" | "one_time" | "package";
  billingCycle: string;
  amountPaise: string;
  admissionFeePaise: string;
  billingDay: number;
  graceDays: number;
  taxRateBp: number;
  isActive: boolean;
  installments: Installment[];
};

const KINDS = [
  ["recurring", "Repeats"],
  ["term", "Installments"],
  ["one_time", "One-time"],
] as const;
const CYCLES = [
  ["monthly", "Every month"],
  ["quarterly", "Every 3 months"],
  ["half_yearly", "Every 6 months"],
  ["yearly", "Every year"],
] as const;
const GST_RATES = [0, 5, 12, 18, 28];

type Row = { label: string; amount: string; days: string };
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
const rowsOf = (plan?: PlanForm): Row[] =>
  plan?.installments.length
    ? plan.installments.map((i) => ({ label: i.label, amount: rupeesInput(i.amount_paise), days: String(i.due_offset_days) }))
    : [
        { label: "1st installment", amount: "", days: "0" },
        { label: "2nd installment", amount: "", days: "90" },
      ];

// One sheet for adding and editing; a plan's type is fixed once students are on it.
export function PlanEditor({ plan, programs, trigger, children }: { plan?: PlanForm; programs: { id: string; name: string }[]; trigger: ReactElement; children: ReactNode }) {
  const a = useAction();
  const [kind, setKind] = useState<PlanForm["kind"]>(plan?.kind ?? "recurring");
  const [rows, setRows] = useState<Row[]>(rowsOf(plan));
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const amounts = rows.map((r) => parseRupees(r.amount));
  const url = plan ? `/api/fee-plans/${plan.id}` : "/api/fee-plans";

  return (
    <Sheet
      open={a.open}
      onOpenChange={(o) => {
        a.setOpen(o);
        if (o) {
          setKind(plan?.kind ?? "recurring");
          setRows(rowsOf(plan));
        }
      }}
    >
      <SheetTrigger render={trigger}>{children}</SheetTrigger>
      <SheetForm
        trigger={plan ? `Edit ${plan.name}` : "Add plan"}
        title={plan ? plan.name : "New fee plan"}
        submitLabel="Save plan"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const str = (k: string) => ((f.get(k) as string | null) ?? "").trim();
          const money = (k: string) => (str(k) ? parseRupees(str(k)) : 0n);
          const [amount, admission] = [money("amount"), money("admission")];
          if (amount === undefined || admission === undefined || (kind === "term" && amounts.some((x) => x === undefined))) {
            void a.run(async () => "Enter amounts like 800 or 1,500.50");
            return;
          }
          const body = {
            name: str("name"),
            programId: str("programId") || null,
            kind,
            admissionFeePaise: String(admission),
            graceDays: Number(str("graceDays") || 0),
            taxRateBp: Number(str("gst")) * 100,
            ...(kind === "recurring" ? { billingCycle: str("billingCycle"), billingDay: Number(str("billingDay") || 1) } : {}),
            ...(kind === "term"
              ? { installments: rows.map((r, i) => ({ label: r.label.trim(), amountPaise: String(amounts[i] ?? 0n), dueOffsetDays: Number(r.days || 0) })) }
              : { amountPaise: String(amount) }),
          };
          void a.run(() => send(url, plan ? "PATCH" : "POST", body));
        }}
      >
        <Field label="Name" id="plan-name">
          <Input id="plan-name" name="name" defaultValue={plan?.name} required placeholder="e.g. Karate Monthly" autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" id="plan-kind">
            <select id="plan-kind" value={kind} onChange={(e) => setKind(e.target.value as PlanForm["kind"])} className={selectClass}>
              {KINDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
              {plan?.kind === "package" ? <option value="package">Package (later)</option> : null}
            </select>
          </Field>
          <Field label="Program" id="plan-program">
            <select id="plan-program" name="programId" defaultValue={plan?.programId ?? ""} className={selectClass}>
              <option value="">Any</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {kind === "recurring" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="How often" id="plan-cycle">
              <select id="plan-cycle" name="billingCycle" defaultValue={plan?.billingCycle === "one_time" ? "monthly" : (plan?.billingCycle ?? "monthly")} className={selectClass}>
                {CYCLES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bills on day" id="plan-day">
              <Input id="plan-day" name="billingDay" type="number" inputMode="numeric" min={1} max={28} defaultValue={plan?.billingDay ?? 1} />
            </Field>
          </div>
        ) : null}

        {kind === "term" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-label">Installments</legend>
            <div className="grid grid-cols-[1fr_6.5rem_4.5rem_2.5rem] gap-2 text-caption text-muted-foreground">
              <span>Name</span>
              <span>₹</span>
              <span>Due after days</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_6.5rem_4.5rem_2.5rem] items-center gap-2">
                <Input aria-label={`Installment ${i + 1} name`} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                <Input aria-label={`Installment ${i + 1} amount`} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
                <Input aria-label={`Installment ${i + 1} due after days`} inputMode="numeric" value={r.days} onChange={(e) => setRow(i, { days: e.target.value })} />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove installment ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rows.length >= 12}
                onClick={() => setRows([...rows, { label: `${ordinal(rows.length + 1)} installment`, amount: "", days: String(Number(rows.at(-1)?.days ?? 0) + 90) }])}
              >
                <Plus /> Add installment
              </Button>
              <span className="text-label tabular-nums">Total {formatPaise(sum(amounts.map((x) => x ?? 0n)))}</span>
            </div>
          </fieldset>
        ) : (
          <Field label="Fee (₹)" id="plan-amount">
            <Input id="plan-amount" name="amount" inputMode="decimal" defaultValue={plan && plan.kind !== "term" ? rupeesInput(plan.amountPaise) : ""} placeholder="800" />
          </Field>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Admission (₹)" id="plan-admission">
            <Input id="plan-admission" name="admission" inputMode="decimal" defaultValue={plan ? rupeesInput(plan.admissionFeePaise) : ""} placeholder="0" />
          </Field>
          <Field label="Days to pay" id="plan-grace">
            <Input id="plan-grace" name="graceDays" type="number" inputMode="numeric" min={0} max={90} defaultValue={plan?.graceDays ?? 7} />
          </Field>
          <Field label="GST" id="plan-gst">
            <select id="plan-gst" name="gst" defaultValue={String((plan?.taxRateBp ?? 0) / 100)} className={selectClass}>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r ? `${r}%` : "None"}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {plan ? (
          <Button type="button" variant="ghost" disabled={a.busy} onClick={() => void a.run(() => send(url, "PATCH", { isActive: !plan.isActive }))}>
            {plan.isActive ? "Archive plan" : "Use this plan again"}
          </Button>
        ) : null}
      </SheetForm>
    </Sheet>
  );
}
