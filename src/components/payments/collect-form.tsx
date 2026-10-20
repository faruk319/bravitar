"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Money } from "@/components/money";
import { useBranch } from "@/components/shell/tenant-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { formatDayMonth } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { formatPaise } from "@/lib/money/format";
import { type Paise, parseRupees, sum } from "@/lib/money/paise";
import { formatPhone } from "@/lib/phone";
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
type Purpose = "fees" | "advance";

const PER: Record<string, string> = { monthly: "a month", quarterly: "every 3 months", half_yearly: "every 6 months", yearly: "a year" };
const asInput = (paise: Paise) => (paise === 0n ? "" : formatPaise(paise).slice(1));
export const payerIds = (p: Payer) => (p.kind === "guardian" ? { payerGuardianId: p.guardianId } : { payerMemberId: p.memberId });
// The drawer's URL on top of the page's own params.
const drawerHref = (closeHref: string, extra = "") => `${closeHref}${closeHref.includes("?") ? "&" : "?"}collect=1${extra}`;

const planText = (p: PlanLine) => `${p.planName} · ${formatPaise(p.amountPaise)} ${p.kind === "recurring" ? (PER[p.cycle] ?? "") : p.kind === "term" ? "in installments" : "once"}`.trim();

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

// A right-hand panel from md up, the full height on phones. Closing goes back to closeHref, the page without the sheet's params.
export function Frame({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        setOpen(false);
        router.replace(closeHref, { scroll: false });
      }}
    >
      <SheetContent side="auto" className="data-[side=bottom]:h-dvh data-[side=bottom]:max-h-dvh data-[side=bottom]:rounded-none">
        <SheetTitle className="text-heading">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}

// The drawer before a member is chosen.
export function CollectSearch({ closeHref }: { closeHref: string }) {
  return (
    <Frame title="Collect payment" closeHref={closeHref}>
      <MemberSearch hrefFor={(id) => drawerHref(closeHref, `&student=${id}`)} />
    </Frame>
  );
}

// docs/07 §7.4 and the finance spec's drawer. The payer is asked for when there is no single one, never guessed,
// and always sent. One request id per drawer, so a retry after a dropped connection can never pay twice.
export function CollectDrawer({ screen, preselect, closeHref }: { screen: CollectScreen; preselect: string[]; closeHref: string }) {
  const { branches } = useBranch();
  const [requestId] = useState(() => uuidv7());
  const [payerKey, setPayerKey] = useState(() => screen.payers.find((p) => p.open.some((i) => preselect.includes(i.id)))?.key ?? screen.defaultPayerKey);
  const [choosing, setChoosing] = useState(false);
  const payer = screen.payers.find((p) => p.key === payerKey);
  return (
    <Frame title="Collect payment" closeHref={closeHref}>
      <p className="-mt-2 text-caption text-muted-foreground">
        <span className="text-body text-neutral-900">{screen.memberName}</span> {screen.memberCode}
        {branches.length > 1 ? ` · ${screen.branchName}` : ""} ·{" "}
        <Link href={drawerHref(closeHref)} replace scroll={false} className="text-accent-600 hover:underline">
          Another member
        </Link>
      </p>
      {payer && !choosing ? (
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3">
          <span className="min-w-0 truncate text-body">
            <span className="text-muted-foreground">Paying </span>
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
          chosen={payerKey}
          onPick={(key) => {
            setPayerKey(key);
            setChoosing(false);
          }}
        />
      )}
      {payer ? <PaymentForm key={payer.key} screen={screen} payer={payer} preselect={preselect} requestId={requestId} /> : null}
    </Frame>
  );
}

function PayerPicker({ payers, chosen, onPick }: { payers: PayerOption[]; chosen: string | null; onPick: (key: string) => void }) {
  return (
    <div role="group" aria-labelledby="payer-pick" className="flex flex-col gap-2">
      <h3 id="payer-pick" className="text-label">
        Who is paying?
      </h3>
      {payers.map((p) => {
        const owes = sum(p.open.map((i) => i.balancePaise));
        return (
          <button
            key={p.key}
            type="button"
            aria-pressed={p.key === chosen}
            onClick={() => onPick(p.key)}
            className={cn("flex min-h-14 items-center gap-3 rounded-lg border px-3 text-left", p.key === chosen ? "border-accent-600 bg-accent-50" : "border-neutral-300")}
          >
            <Avatar name={p.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body text-neutral-900">
                {p.name}
                {p.relation ? <span className="text-caption text-muted-foreground"> · {p.relation}</span> : null}
              </span>
              <span className="block text-caption text-muted-foreground">{[owes ? `Owes ${formatPaise(owes)}` : "Nothing due", p.advancePaise > 0n ? `${formatPaise(p.advancePaise)} advance` : ""].filter(Boolean).join(" · ")}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
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

// Sections 3–8 for the chosen payer. The amount follows what is ticked until it is typed over.
function PaymentForm({ screen, payer, preselect, requestId }: { screen: CollectScreen; payer: PayerOption; preselect: string[]; requestId: string }) {
  const router = useRouter();
  const owes = payer.open.length > 0;
  const [purpose, setPurpose] = useState<Purpose>(owes ? "fees" : "advance");
  const [ticked, setTicked] = useState(() => {
    const asked = payer.open.filter((i) => preselect.includes(i.id));
    return new Set((asked.length ? asked : payer.open).map((i) => i.id));
  });
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

  const fees = purpose === "fees" && owes; // nothing open (say, after Use advance now) leaves only Advance
  const rows = fees ? payer.open.filter((i) => ticked.has(i.id)) : [];
  const ticks = sum(rows.map((i) => i.balancePaise));
  const amount = typed ?? asInput(ticks);
  const paise = parseRupees(amount);
  const live = paise ? preview(paise, rows, fees ? custom : null) : undefined;
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
          payer.open.map((i) => <DueLine key={i.id} i={i} today={screen.today} who={many ? i.students.join(", ") : ""} tick={fees ? { on: ticked.has(i.id), toggle: () => toggle(i.id) } : undefined} />)
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
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={cn("flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-label has-checked:border-accent-600 has-checked:bg-accent-50", value === "fees" && !owes && "cursor-not-allowed opacity-50")}>
              <input type="radio" name="purpose" value={value} checked={(fees ? "fees" : "advance") === value} disabled={value === "fees" && !owes} onChange={() => setPurpose(value)} className="accent-accent-600" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pay-amount">Amount received</Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body text-muted-foreground">₹</span>
          <Input id="pay-amount" inputMode="decimal" autoComplete="off" className="pl-7 text-number tabular-nums" value={amount} onChange={(e) => setTyped(e.target.value)} />
        </div>
        {fees && custom ? (
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
        {fees && rows.length ? (
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

type Row = { student: { id: string; fullName: string; code: string; branchId: string }; guardianName: string | null; guardianPhone: string | null };

// Find the member by their name, a parent's name or a phone number.
export function MemberSearch({ hrefFor }: { hrefFor: (studentId: string) => string }) {
  const { branches } = useBranch();
  const [hits, setHits] = useState<Row[]>([]);
  const [searched, setSearched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function search(q: string) {
    clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setSearched(false);
      return setHits([]);
    }
    timer.current = setTimeout(async () => {
      const r = await request<{ students: Row[] }>(`/api/students?q=${encodeURIComponent(q.trim())}`, "GET");
      setHits(r.data?.students.slice(0, 8) ?? []);
      setSearched(true);
    }, 200);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="member-search">Member</Label>
      <Input id="member-search" type="search" autoFocus autoComplete="off" placeholder="Child, parent or phone" onChange={(e) => search(e.target.value)} />
      {hits.length ? (
        <ul className="flex flex-col">
          {hits.map((h) => {
            const branch = branches.length > 1 ? branches.find((b) => b.id === h.student.branchId)?.name : undefined;
            const guardian = h.guardianName ? `${h.guardianName} · ${formatPhone(h.guardianPhone ?? "")}` : "";
            return (
              <li key={h.student.id}>
                <Link href={hrefFor(h.student.id)} replace scroll={false} className="flex min-h-14 items-center gap-3 rounded-lg px-2 hover:bg-neutral-50">
                  <Avatar name={h.student.fullName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-neutral-900">
                      {h.student.fullName} <span className="text-caption text-muted-foreground">{h.student.code}</span>
                    </span>
                    {guardian || branch ? <span className="block truncate text-caption text-muted-foreground">{[guardian, branch].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : searched ? (
        <p className="text-caption text-muted-foreground">No one found.</p>
      ) : null}
    </div>
  );
}
