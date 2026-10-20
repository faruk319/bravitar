"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { PaymentForm } from "@/components/payments/payment-form";
import { useBranch } from "@/components/shell/tenant-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { uuidv7 } from "@/lib/ids";
import { formatPaise } from "@/lib/money/format";
import { sum } from "@/lib/money/paise";
import { formatPhone } from "@/lib/phone";
import { request } from "@/lib/send";
import { cn } from "@/lib/utils";
import type { CollectScreen, PayerOption } from "@/modules/payments/service";

// The drawer's URL on top of the page's own params.
const drawerHref = (closeHref: string, extra = "") => `${closeHref}${closeHref.includes("?") ? "&" : "?"}collect=1${extra}`;

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
