"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { formatPaise } from "@/lib/money/format";
import { parseRupees, sum } from "@/lib/money/paise";
import { formatPhone } from "@/lib/phone";
import { request } from "@/lib/send";
import { cn } from "@/lib/utils";
import { oldestFirst } from "@/modules/payments/allocation";

export type DueInvoice = { id: string; number: string; dueDate: string; balance: string; overdue: boolean }; // balance in paise

const METHODS = [
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["bank_transfer", "Bank"],
  ["cheque", "Cheque"],
] as const;
type Method = (typeof METHODS)[number][0];

const asInput = (paise: bigint) => (paise === 0n ? "" : formatPaise(paise).slice(1));

// docs/07 §7.4: family, what's due (all ticked), amount already filled in, cash.
// The common case is one tap on Record. The request id is made once per form,
// so a retry after a dropped connection can never pay twice.
export function CollectForm({ householdId, branchId, due, advance, preselect, today, earliest }: { householdId: string; branchId: string; due: DueInvoice[]; advance: string; preselect?: string[]; today: string; earliest: string }) {
  const router = useRouter();
  const [requestId] = useState(() => uuidv7());
  const [ticked, setTicked] = useState(() => new Set(preselect ?? due.map((d) => d.id)));
  const selected = sum(due.filter((d) => ticked.has(d.id)).map((d) => BigInt(d.balance)));
  const [amount, setAmount] = useState(asInput(selected));
  const touched = useRef(false);
  const [method, setMethod] = useState<Method>("cash");
  const [reference, setReference] = useState("");
  const [earlier, setEarlier] = useState(false);
  const [receivedOn, setReceivedOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const paise = parseRupees(amount);
  const open = due.filter((d) => ticked.has(d.id)).map((d) => ({ invoiceId: d.id, balance: BigInt(d.balance) }));
  const split = paise ? oldestFirst(paise, open) : undefined;

  function toggle(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
    if (!touched.current) setAmount(asInput(sum(due.filter((d) => next.has(d.id)).map((d) => BigInt(d.balance)))));
  }

  async function submit() {
    if (!paise) return setError("Enter the amount received");
    setBusy(true);
    setError(undefined);
    const r = await request<{ id: string }>("/api/payments", "POST", {
      requestId,
      householdId,
      branchId,
      amountPaise: String(paise),
      method,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(earlier && receivedOn !== today ? { receivedOn } : {}),
      allocations: (split?.shares ?? []).map((s) => ({ invoiceId: s.invoiceId, amountPaise: String(s.amountPaise) })),
    });
    if (r.data) return router.push(`/payments/${r.data.id}`);
    setBusy(false);
    setError(r.offline ? "No connection. Nothing was saved; try again." : r.error);
  }

  const note = !paise
    ? "Enter the amount received"
    : !open.length
      ? "Kept as the family's advance"
      : split && split.advance > 0n
        ? `${formatPaise(split.advance)} more than selected: kept as the family's advance`
        : paise < selected
          ? `Part payment: ${formatPaise(paise)} of ${formatPaise(selected)}`
          : "Pays the selected invoices";

  return (
    <form
      className="flex max-w-md flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-label">Outstanding</legend>
        {due.length ? (
          due.map((d) => (
            <label key={d.id} className="flex min-h-14 items-center gap-3 rounded-lg border border-neutral-100 px-3">
              <input type="checkbox" className="size-5 accent-accent-600" checked={ticked.has(d.id)} onChange={() => toggle(d.id)} />
              <span className="min-w-0 flex-1">
                <span className="block text-body tabular-nums">{d.number}</span>
                <span className={cn("block text-caption", d.overdue ? "text-danger-600" : "text-muted-foreground")}>
                  {d.overdue ? "Overdue · " : ""}due {formatDate(d.dueDate)}
                </span>
              </span>
              <Money paise={BigInt(d.balance)} className="text-body" />
            </label>
          ))
        ) : (
          <p className="text-body text-muted-foreground">Nothing due. Anything paid is kept as the family&apos;s advance.</p>
        )}
        {due.length ? (
          <div className="flex min-h-10 items-center justify-between px-1 text-body">
            <span>Selected</span>
            <Money paise={selected} className="font-medium" />
          </div>
        ) : null}
        {BigInt(advance) > 0n ? <p className="px-1 text-caption text-muted-foreground">Already on advance: {formatPaise(BigInt(advance))}, used when the next invoice is issued</p> : null}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pay-amount">Amount received</Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body text-muted-foreground">₹</span>
          <Input
            id="pay-amount"
            inputMode="decimal"
            autoComplete="off"
            autoFocus={!due.length}
            className="pl-7 text-number tabular-nums"
            value={amount}
            onChange={(e) => {
              touched.current = true;
              setAmount(e.target.value);
            }}
          />
        </div>
        <p className="text-caption text-muted-foreground" aria-live="polite">
          {note}
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-label">Method</legend>
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={method === value}
              onClick={() => setMethod(value)}
              className={cn("h-12 rounded-full border text-label", method === value ? "border-accent-600 bg-accent-50 text-accent-600" : "border-neutral-300 text-neutral-700")}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pay-reference">{method === "cash" ? "Note (optional)" : method === "cheque" ? "Cheque number" : "Reference (optional)"}</Label>
        <Input id="pay-reference" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "upi" ? "UPI reference" : method === "bank_transfer" ? "Bank UTR" : ""} />
      </div>

      {earlier ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-date">Received on</Label>
          <Input id="pay-date" type="date" min={earliest} max={today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          <p className="text-caption text-muted-foreground">It still counts in today&apos;s collection, the day it reaches the drawer.</p>
        </div>
      ) : (
        <button type="button" className="self-start text-label text-accent-600 hover:underline" onClick={() => setEarlier(true)}>
          Received on an earlier day?
        </button>
      )}

      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Saving…" : paise ? `Record ${formatPaise(paise)}` : "Record payment"}
      </Button>
    </form>
  );
}

type Row = { student: { id: string; fullName: string; code: string }; guardianName: string | null; guardianPhone: string | null };

// Find the family by a child's name, the parent's name or a phone number.
export function FamilySearch() {
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
    <div className="flex max-w-md flex-col gap-2">
      <Label htmlFor="family-search">Family</Label>
      <Input id="family-search" type="search" autoFocus autoComplete="off" placeholder="Child, parent or phone" onChange={(e) => search(e.target.value)} />
      {hits.length ? (
        <ul className="flex flex-col">
          {hits.map((h) => (
            <li key={h.student.id}>
              <Link href={`/payments/new?student=${h.student.id}`} className="flex min-h-14 items-center gap-3 rounded-lg px-2 hover:bg-neutral-50">
                <Avatar name={h.student.fullName} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-neutral-900">
                    {h.student.fullName} <span className="text-caption text-muted-foreground">{h.student.code}</span>
                  </span>
                  {h.guardianName ? <span className="block truncate text-caption text-muted-foreground">{`${h.guardianName} · ${formatPhone(h.guardianPhone ?? "")}`}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : searched ? (
        <p className="text-caption text-muted-foreground">No one found.</p>
      ) : null}
    </div>
  );
}
