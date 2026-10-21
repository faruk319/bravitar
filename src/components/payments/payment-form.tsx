"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChargeFields, type ChargeInput, KINDS } from "@/components/fees/charge-fields";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDayMonth } from "@/lib/dates";
import { asInput, formatPaise } from "@/lib/money/format";
import { type Paise, parseRupees, sum } from "@/lib/money/paise";
import { request } from "@/lib/send";
import { cn } from "@/lib/utils";
import { isOverdue } from "@/modules/fees/billing";
import { type Share, type Split, splitPreview } from "@/modules/payments/allocation";
import type { CollectScreen, DueRow, PayerOption, PlanLine } from "@/modules/payments/service";
import type { Payer } from "@/modules/students/payer";

const METHODS = [
  ["cash", "Cash", "Reference (optional)"],
  ["upi", "UPI", "UPI reference (optional)"],
  ["card", "Card", "Approval code (optional)"],
  ["bank_transfer", "Bank", "Bank UTR (optional)"],
  ["cheque", "Cheque", "Cheque number (optional)"],
] as const;
type Method = (typeof METHODS)[number][0];
type Purpose = "fees" | "advance" | "charge" | "pack";

const PER: Record<string, string> = { monthly: "a month", quarterly: "every 3 months", half_yearly: "every 6 months", yearly: "a year" };
export const payerIds = (p: Payer) => (p.kind === "guardian" ? { payerGuardianId: p.guardianId } : { payerMemberId: p.memberId });
const PAID_IN_FULL = "A charge added here is paid in full"; // the server's words
const PACK_IN_FULL = "A session pack is paid in full";

const planText = (p: PlanLine) => `${p.planName} · ${formatPaise(p.amountPaise)} ${p.kind === "recurring" ? (PER[p.cycle] ?? "") : p.kind === "term" ? "in installments" : p.kind === "package" ? "a pack" : "once"}`.trim();

// Overdue beats Part paid (spec, words on screen); -700 text, accent has only 600.
function dueStatus(i: DueRow, today: string): [string, string] {
  if (isOverdue(i, today)) return ["Overdue", "text-danger-700"];
  return i.status === "part_paid" ? ["Part paid", "text-accent-600"] : ["Due", "text-warning-700"];
}

// The split recording would make, or why it would refuse, in the server's words. Under Change split a blank or zero leaves an invoice out.
function preview(amount: Paise, rows: DueRow[], custom: Record<string, string> | null): { split: Split & { stillDue: Paise } } | { error: string } {
  try {
    const typed = custom
      ? rows.flatMap((r): Share[] => {
          const text = custom[r.id]?.trim() ?? "";
          const p = text ? parseRupees(text) : 0n;
          if (p === undefined) throw new Error("Enter an amount");
          return p > 0n ? [{ invoiceId: r.id, amountPaise: p }] : [];
        })
      : undefined;
    return { split: splitPreview(amount, rows.map((r) => ({ invoiceId: r.id, balance: r.balancePaise })), typed) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Check the amounts" };
  }
}

// One open invoice: what it was for, its number, due date and status; part paid shows what is left.
function DueLine({ i, today, who, tick }: { i: DueRow; today: string; who: string; tick?: { on: boolean; toggle: () => void } | undefined }) {
  const [word, tone] = dueStatus(i, today);
  const Tag = tick ? "label" : "div";
  return (
    <Tag className="flex min-h-14 items-center gap-3 rounded-lg border border-neutral-100 px-3 py-2">
      {tick ? <input type="checkbox" className="size-5 shrink-0 accent-accent-600" checked={tick.on} onChange={tick.toggle} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-body text-neutral-900">{[who, i.description || i.number].filter(Boolean).join(" · ")}</span>
        <span className="block text-caption text-muted-foreground">
          {i.number} · due {formatDayMonth(i.dueDate)} · <span className={tone}>{word}</span>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <Money paise={i.balancePaise} className="block text-body" />
        {i.paidPaise > 0n ? <span className="block text-caption text-muted-foreground">of {formatPaise(i.totalPaise)}</span> : null}
      </span>
    </Tag>
  );
}

// Sections 3–8 for the chosen payer. The amount follows what is ticked, plus a new charge, until it is typed over.
// A new charge is paid in full first; what is above it pays the ticked invoices, then is advance.
export function PaymentForm({ screen, payer, preselect, requestId }: { screen: CollectScreen; payer: PayerOption; preselect: string[]; requestId: string }) {
  const router = useRouter();
  const owes = payer.open.length > 0;
  const [purpose, setPurpose] = useState<Purpose>(owes ? "fees" : "advance");
  const [ticked, setTicked] = useState(() => {
    const asked = payer.open.filter((i) => preselect.includes(i.id));
    return new Set((asked.length ? asked : payer.open).map((i) => i.id));
  });
  const [charge, setCharge] = useState<ChargeInput>({ kind: "other", description: "", amount: "", enrollmentId: "" });
  // Packs sell only for the opened member's own programs on a pack plan.
  const packs = payer.plans.filter((p) => p.packPaise !== undefined && screen.enrollments.some((e) => e.id === p.enrollmentId));
  const [packId, setPackId] = useState(packs[0]?.enrollmentId ?? "");
  const [typed, setTyped] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<string, string> | null>(null);
  const [method, setMethod] = useState<Method>("cash");
  const [reference, setReference] = useState("");
  const [earlier, setEarlier] = useState(false);
  const [receivedOn, setReceivedOn] = useState(screen.today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [used, setUsed] = useState<string>();

  const mode: Purpose = purpose === "fees" && !owes ? "advance" : purpose; // nothing open (say, after Use advance now) leaves no fees to pay
  const charging = mode === "charge";
  const pack = mode === "pack" ? packs.find((p) => p.enrollmentId === packId) : undefined;
  const tickable = owes && mode !== "advance";
  const rows = tickable ? payer.open.filter((i) => ticked.has(i.id)) : [];
  const ticks = sum(rows.map((i) => i.balancePaise));
  const cost = charging ? (parseRupees(charge.amount) ?? 0n) : (pack?.packPaise ?? 0n);
  const amount = typed ?? asInput(ticks + cost);
  const paise = parseRupees(amount);
  const live = paise ? (paise < cost ? { error: pack ? PACK_IN_FULL : PAID_IN_FULL } : preview(paise - cost, rows, tickable ? custom : null)) : undefined;
  const split = live && "split" in live ? live.split : undefined;
  const stillDue = split ? split.stillDue + sum(payer.open.map((i) => i.balancePaise)) - ticks : 0n; // the unticked ones are still due too
  const many = new Set([...payer.plans.map((p) => p.studentName), ...payer.open.flatMap((i) => i.students)]).size > 1;

  function toggle(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  }

  async function applyNow() {
    setBusy(true);
    setError(undefined);
    const r = await request<{ appliedPaise: string }>("/api/payments/advance", "POST", { branchId: screen.branchId, ...payerIds(payer.payer) });
    setBusy(false);
    if (!r.data) return setError(r.error);
    setUsed(`${formatPaise(BigInt(r.data.appliedPaise))} used from advance`);
    router.refresh();
  }

  async function submit() {
    if (charging && !charge.description.trim()) return setError("Say what the charge is for");
    if (charging && !cost) return setError("Enter the charge amount");
    if (mode === "pack" && !pack) return setError("Pick the session pack");
    if (!paise) return setError("Enter the amount received");
    if (!split) return setError(live && "error" in live ? live.error : "Check the amounts");
    setBusy(true);
    setError(undefined);
    const r = await request<{ id: string }>("/api/payments", "POST", {
      requestId,
      memberId: screen.memberId,
      branchId: screen.branchId,
      ...payerIds(payer.payer),
      amountPaise: String(paise),
      method,
      allocations: split.shares.map((s) => ({ invoiceId: s.invoiceId, amountPaise: String(s.amountPaise) })),
      ...(pack ? { pack: { enrollmentId: pack.enrollmentId } } : {}),
      ...(charging ? { charge: { kind: charge.kind, description: charge.description.trim(), amountPaise: String(cost), ...(charge.enrollmentId ? { enrollmentId: charge.enrollmentId } : {}) } } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(earlier && receivedOn !== screen.today ? { receivedOn } : {}),
    });
    if (r.data) return router.replace(`/finance/collections/${r.data.id}`);
    setBusy(false);
    setError(r.offline ? "No connection. Nothing was saved; try again." : r.error);
  }

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section aria-labelledby="pay-owe" className="flex flex-col gap-2">
        <h3 id="pay-owe" className="text-label">
          What they owe
        </h3>
        {payer.plans.map((p) => (
          <p key={p.enrollmentId} className="text-caption text-muted-foreground">
            {many ? `${p.studentName} · ` : ""}
            {planText(p)}
          </p>
        ))}
        {owes ? (
          payer.open.map((i) => <DueLine key={i.id} i={i} today={screen.today} who={many ? i.students.join(", ") : ""} tick={tickable ? { on: ticked.has(i.id), toggle: () => toggle(i.id) } : undefined} />)
        ) : (
          <p className="text-body text-muted-foreground">Nothing due.</p>
        )}
        {payer.advancePaise > 0n ? (
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-2">
            <span className="text-body">
              Advance held <Money paise={payer.advancePaise} className="font-medium" />
            </span>
            {owes ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void applyNow()}>
                Use advance now
              </Button>
            ) : null}
          </div>
        ) : null}
        {used ? (
          <p role="status" className="text-caption text-success-700">
            {used}
          </p>
        ) : null}
      </section>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-label">What is this payment for?</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["fees", "Fees due"],
              ["advance", "Advance"],
              ["charge", "New charge"],
              ...(packs.length ? ([["pack", "Session pack"]] as const) : []),
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={cn("flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-label has-checked:border-accent-600 has-checked:bg-accent-50", value === "fees" && !owes && "cursor-not-allowed opacity-50")}>
              <input type="radio" name="purpose" value={value} checked={mode === value} disabled={value === "fees" && !owes} onChange={() => setPurpose(value)} className="accent-accent-600" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {charging ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-neutral-100 p-3">
          <legend className="sr-only">New charge</legend>
          <ChargeFields id="new" value={charge} enrollments={screen.enrollments} onChange={(patch) => setCharge((c) => ({ ...c, ...patch }))} />
        </fieldset>
      ) : null}

      {mode === "pack" && packs.length > 1 ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="pay-pack">Session pack</Label>
          <select id="pay-pack" value={packId} onChange={(e) => setPackId(e.target.value)} className="h-12 rounded-lg border border-border bg-background px-3 text-base">
            {packs.map((p) => (
              <option key={p.enrollmentId} value={p.enrollmentId}>
                {p.planName} · {p.programName}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="pay-amount">Amount received</Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body text-muted-foreground">₹</span>
          <Input id="pay-amount" inputMode="decimal" autoComplete="off" className="pl-7 text-number tabular-nums" value={amount} onChange={(e) => setTyped(e.target.value)} />
        </div>
        {(charging || pack) && cost > 0n && split ? (
          <p className="flex justify-between gap-3 text-caption">
            <span>{pack ? pack.planName : charge.description.trim() || KINDS.find(([kind]) => kind === charge.kind)?.[1]}</span>
            <Money paise={cost} />
          </p>
        ) : null}
        {tickable && custom ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Split</legend>
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <Label htmlFor={`split-${r.id}`} className="min-w-0 flex-1 text-body font-normal">
                  {r.number} <span className="text-caption text-muted-foreground">of {formatPaise(r.balancePaise)}</span>
                </Label>
                <Input id={`split-${r.id}`} inputMode="decimal" autoComplete="off" className="w-32 tabular-nums" value={custom[r.id] ?? ""} onChange={(e) => setCustom({ ...custom, [r.id]: e.target.value })} />
              </div>
            ))}
          </fieldset>
        ) : (
          split?.shares.map((s) => (
            <p key={s.invoiceId} className="flex justify-between gap-3 text-caption">
              <span>{rows.find((r) => r.id === s.invoiceId)?.number}</span>
              <Money paise={s.amountPaise} />
            </p>
          ))
        )}
        <div className="flex flex-col gap-1 text-caption" aria-live="polite">
          {!paise ? (
            <p className="text-muted-foreground">Enter the amount received</p>
          ) : live && "error" in live ? (
            <p className="text-danger-700">{live.error}</p>
          ) : split ? (
            <>
              {split.advance > 0n ? <p>{formatPaise(split.advance)} kept as advance — pays the next invoice by itself</p> : null}
              {stillDue > 0n ? <p>Still due after this: {formatPaise(stillDue)}</p> : null}
            </>
          ) : null}
        </div>
        {tickable && rows.length ? (
          <button
            type="button"
            className="min-h-11 self-start text-label text-accent-600 hover:underline"
            onClick={() => setCustom(custom ? null : Object.fromEntries(rows.map((r) => [r.id, asInput(split?.shares.find((s) => s.invoiceId === r.id)?.amountPaise ?? 0n)])))}
          >
            {custom ? "Oldest first" : "Change split"}
          </button>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-label">Method</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {METHODS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={method === value}
              onClick={() => setMethod(value)}
              className={cn("h-12 rounded-full border px-1 text-label", method === value ? "border-accent-600 bg-accent-50 text-accent-600" : "border-neutral-300 text-neutral-700")}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pay-reference">{METHODS.find(([value]) => value === method)?.[2]}</Label>
        <Input id="pay-reference" autoComplete="off" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>

      {earlier ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-date">Received on</Label>
          <Input id="pay-date" type="date" min={screen.earliest} max={screen.today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          <p className="text-caption text-muted-foreground">Counts in today&apos;s collection.</p>
        </div>
      ) : (
        <button type="button" className="min-h-11 self-start text-label text-accent-600 hover:underline" onClick={() => setEarlier(true)}>
          Received on an earlier day?
        </button>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pay-notes">Notes (optional)</Label>
        <textarea id="pay-notes" rows={2} maxLength={300} placeholder="Only staff see this" value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-base" />
      </div>

      {error ? (
        <p role="alert" className="text-label text-danger-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Saving…" : paise ? `Record ${formatPaise(paise)}` : "Record payment"}
      </Button>
    </form>
  );
}
