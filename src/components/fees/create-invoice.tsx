"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Frame, MemberSearch, payerIds } from "@/components/payments/collect-form";
import { Field } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays } from "@/lib/dates";
import { formatPaise } from "@/lib/money/format";
import { type Paise, parseRupees, percent, sum } from "@/lib/money/paise";
import { request } from "@/lib/send";
import { cn } from "@/lib/utils";
import type { CreateScreen, EditSeed } from "@/modules/fees/service";

const KINDS = [
  ["admission", "Admission"],
  ["exam", "Exam"],
  ["item", "Uniform & kit"],
  ["other", "Other"],
] as const;
type Kind = (typeof KINDS)[number][0];
type Line = { id: number; kind: Kind; description: string; amount: string; enrollmentId: string; tax: string };

const select = "h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base";
const blank = (id: number): Line => ({ id, kind: "other", description: "", amount: "", enrollmentId: "", tax: "" });
const asInput = (paise: Paise) => (paise === 0n ? "" : formatPaise(paise).slice(1));
const asKind = (kind: string): Kind => KINDS.find(([value]) => value === kind)?.[0] ?? "other";
// The sheet's URL on top of the page's own params.
const sheetHref = (closeHref: string, extra = "") => `${closeHref}${closeHref.includes("?") ? "&" : "?"}create=1${extra}`;

// "18" or "9.5" → basis points; blank is none; undefined if it isn't a percent.
function rateBp(text: string): number | undefined {
  const t = text.trim();
  if (!t) return 0;
  return /^\d{1,3}(\.\d{1,2})?$/.test(t) && Number(t) <= 100 ? Math.round(Number(t) * 100) : undefined;
}

// The sheet before a student is chosen.
export function CreateInvoiceSearch({ closeHref }: { closeHref: string }) {
  return (
    <Frame title="Create invoice" closeHref={closeHref}>
      <MemberSearch hrefFor={(id) => sheetHref(closeHref, `&student=${id}`)} />
    </Frame>
  );
}

function PayerPicker({ payers, chosen, onPick }: { payers: CreateScreen["payers"]; chosen: string | null; onPick: (key: string) => void }) {
  return (
    <div role="group" aria-labelledby="bill-to" className="flex flex-col gap-2">
      <h3 id="bill-to" className="text-label">
        Who pays?
      </h3>
      {payers.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={p.key === chosen}
          onClick={() => onPick(p.key)}
          className={cn("flex min-h-14 items-center gap-3 rounded-lg border px-3 text-left", p.key === chosen ? "border-accent-600 bg-accent-50" : "border-neutral-300")}
        >
          <Avatar name={p.name} size="sm" />
          <span className="min-w-0 flex-1 truncate text-body text-neutral-900">
            {p.name}
            {p.relation ? <span className="text-caption text-muted-foreground"> · {p.relation}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

// One-off charges for a student: saved as a draft, or issued at once. With a seed it edits a draft added by hand.
// The payer follows the programs named until one is picked; programs with different payers ask who pays.
export function CreateInvoiceSheet({ screen, seed, today, closeHref }: { screen: CreateScreen; seed?: EditSeed; today: string; closeHref: string }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(() =>
    seed ? seed.lines.map((l, id) => ({ id, kind: asKind(l.kind), description: l.description, amount: asInput(BigInt(l.amountPaise)), enrollmentId: l.enrollmentId ?? "", tax: l.taxRateBp ? String(l.taxRateBp / 100) : "" })) : [blank(0)],
  );
  const nextId = useRef(lines.length);
  const [picked, setPicked] = useState<string | null>(seed?.payerKey || null);
  const [choosing, setChoosing] = useState(false);
  const [dueDate, setDueDate] = useState(seed?.dueDate ?? addDays(today, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const placed = new Set(lines.flatMap((l) => screen.enrollments.filter((e) => e.id === l.enrollmentId).map((e) => e.payerKey)));
  const followed = placed.size === 0 ? screen.defaultPayerKey : placed.size === 1 ? ([...placed][0] ?? null) : null;
  const chosen = picked ?? followed;
  const payer = screen.payers.find((p) => p.key === chosen);
  const total = sum(
    lines.map((l) => {
      const amount = parseRupees(l.amount);
      const bp = screen.gst ? rateBp(l.tax) : 0;
      return amount ? amount + (bp ? percent(amount, bp) : 0n) : 0n;
    }),
  );
  const set = (id: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  async function submit(issue: boolean) {
    const charges = [];
    for (const l of lines) {
      const amount = parseRupees(l.amount);
      const bp = screen.gst ? rateBp(l.tax) : 0;
      if (!l.description.trim()) return setError("Say what the charge is for");
      if (!amount) return setError("Enter an amount");
      if (bp === undefined) return setError("Enter the tax as a percent, like 18");
      charges.push({ kind: l.kind, description: l.description.trim(), amountPaise: String(amount), ...(l.enrollmentId ? { enrollmentId: l.enrollmentId } : {}), ...(bp ? { taxRateBp: bp } : {}) });
    }
    if (!payer) return setError("Pick who pays");
    setBusy(true);
    setError(undefined);
    const r = await request<{ id: string }>(seed ? `/api/invoices/${seed.id}` : "/api/invoices", "POST", {
      action: seed ? "edit" : "create",
      studentId: screen.student.id,
      ...payerIds(payer.payer),
      ...(dueDate ? { dueDate } : {}),
      lines: charges,
      ...(seed ? {} : { issue }),
    });
    if (r.data) return router.replace(`/finance/invoices/${r.data.id}`);
    setBusy(false);
    setError(r.offline ? "No connection. Nothing was saved; try again." : r.error);
  }

  return (
    <Frame title={seed ? "Edit invoice" : "Create invoice"} closeHref={closeHref}>
      <p className="-mt-2 text-caption text-muted-foreground">
        <span className="text-body text-neutral-900">{screen.student.name}</span> {screen.student.code}
        {seed ? null : (
          <>
            {" · "}
            <Link href={sheetHref(closeHref)} replace scroll={false} className="text-accent-600 hover:underline">
              Another student
            </Link>
          </>
        )}
      </p>
      {payer && !choosing ? (
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3">
          <span className="min-w-0 truncate text-body">
            <span className="text-muted-foreground">Bill to </span>
            {payer.name}
            {payer.relation ? <span className="text-muted-foreground"> · {payer.relation}</span> : null}
          </span>
          {screen.payers.length > 1 ? (
            <button type="button" className="min-h-11 shrink-0 px-1 text-label text-accent-600 hover:underline" onClick={() => setChoosing(true)}>
              Change
            </button>
          ) : null}
        </div>
      ) : (
        <PayerPicker
          payers={screen.payers}
          chosen={chosen}
          onPick={(key) => {
            setPicked(key);
            setChoosing(false);
          }}
        />
      )}
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {lines.map((l, n) => {
          const programId = screen.enrollments.find((e) => e.id === l.enrollmentId)?.programId;
          const billed = l.kind === "admission" && programId ? screen.admissionBilled[programId] : undefined;
          return (
            <fieldset key={l.id} className="flex flex-col gap-3 rounded-lg border border-neutral-100 p-3">
              <legend className="sr-only">Charge {n + 1}</legend>
              <div role="group" aria-label="Kind" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {KINDS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={l.kind === value}
                    onClick={() => set(l.id, { kind: value })}
                    className={cn("h-12 rounded-full border px-1 text-label", l.kind === value ? "border-accent-600 bg-accent-50 text-accent-600" : "border-neutral-300 text-neutral-700")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Field label="What for" id={`charge-what-${l.id}`}>
                <Input id={`charge-what-${l.id}`} autoComplete="off" maxLength={120} value={l.description} onChange={(e) => set(l.id, { description: e.target.value })} />
              </Field>
              <Field label="Amount" id={`charge-amount-${l.id}`}>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body text-muted-foreground">₹</span>
                  <Input id={`charge-amount-${l.id}`} inputMode="decimal" autoComplete="off" className="pl-7 text-number tabular-nums" value={l.amount} onChange={(e) => set(l.id, { amount: e.target.value })} />
                </div>
              </Field>
              {screen.enrollments.length ? (
                <Field label="Program (optional)" id={`charge-program-${l.id}`}>
                  <select id={`charge-program-${l.id}`} value={l.enrollmentId} onChange={(e) => set(l.id, { enrollmentId: e.target.value })} className={select}>
                    <option value="">No program</option>
                    {screen.enrollments.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.programName} · {e.batchName}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {billed ? (
                <p role="status" className="text-caption text-warning-700">
                  Admission already billed on {billed}
                </p>
              ) : null}
              {screen.gst ? (
                <Field label="Tax %" id={`charge-tax-${l.id}`}>
                  <Input id={`charge-tax-${l.id}`} inputMode="decimal" autoComplete="off" className="w-28 tabular-nums" value={l.tax} onChange={(e) => set(l.id, { tax: e.target.value })} />
                </Field>
              ) : null}
              {lines.length > 1 ? (
                <button type="button" className="min-h-11 self-start text-label text-danger-700 hover:underline" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>
                  Remove
                </button>
              ) : null}
            </fieldset>
          );
        })}
        {lines.length < 20 ? (
          <button type="button" className="min-h-11 self-start text-label text-accent-600 hover:underline" onClick={() => setLines([...lines, blank(nextId.current++)])}>
            Add another charge
          </button>
        ) : null}
        <Field label="Due date" id="charge-due">
          <Input id="charge-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        {total > 0n ? (
          <p className="flex justify-between gap-3 text-body">
            <span className="text-muted-foreground">Total</span>
            <span className="font-medium tabular-nums">{formatPaise(total)}</span>
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-label text-danger-700">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          {seed ? null : (
            <Button type="button" size="lg" disabled={busy} onClick={() => void submit(true)}>
              {busy ? "Saving…" : "Create and issue"}
            </Button>
          )}
          <Button type="submit" size="lg" variant={seed ? "default" : "outline"} disabled={busy}>
            {busy ? "Saving…" : seed ? "Save changes" : "Save as draft"}
          </Button>
        </div>
      </form>
    </Frame>
  );
}
