"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { request, send } from "@/lib/send";
import { SOURCE_LABELS, SOURCES } from "@/modules/enquiries/lists";
import type { PhoneMatch } from "@/modules/enquiries/service";

export type Option = { id: string; name: string };
export type BatchOption = Option & { programId: string };

// docs/06 Prompt 18: name, phone and program in 15 seconds; the rest under More.
export function AddEnquiry({ programs, batches, staff, me, tomorrow }: { programs: Option[]; batches: BatchOption[]; staff: Option[]; me: string; tomorrow: string }) {
  const a = useAction();
  const [programId, setProgramId] = useState(programs.length === 1 ? (programs[0]?.id ?? "") : "");
  const [match, setMatch] = useState<PhoneMatch>();
  const check = async (phone: string) => {
    const r = phone.trim() ? await request<PhoneMatch>(`/api/enquiries/check?phone=${encodeURIComponent(phone)}`, "GET") : undefined;
    setMatch(r?.data);
  };
  return (
    <Sheet
      open={a.open}
      onOpenChange={(o) => {
        a.setOpen(o);
        if (!o) setMatch(undefined);
      }}
    >
      <SheetTrigger render={<Button size="lg" />}>
        <Plus data-icon="inline-start" /> Add
      </SheetTrigger>
      <SheetForm
        trigger="Add"
        title="New enquiry"
        submitLabel="Save"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const pick = (k: string) => String(f.get(k) ?? "").trim() || undefined;
          const body = { name: pick("name"), phone: pick("phone"), programId: pick("programId"), contactName: pick("contactName"), source: pick("source"), batchId: pick("batchId"), nextFollowUp: pick("nextFollowUp"), ownerStaffId: pick("ownerStaffId"), notes: pick("notes") };
          void a.run(() => send("/api/enquiries", "POST", body));
        }}
      >
        <Field label="Student's name" id="enq-name">
          <Input id="enq-name" name="name" autoComplete="off" autoFocus required />
        </Field>
        <Field label="Phone" id="enq-phone">
          <Input id="enq-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" required onBlur={(e) => void check(e.target.value)} />
        </Field>
        {match?.enquiries.length || match?.family ? (
          <p className="rounded-lg bg-warning-600/10 px-3 py-2 text-label">
            {match.enquiries.map((m) => (
              <Link key={m.id} href={`/enquiries/${m.id}`} className="block underline">
                Already an enquiry: {m.name}
              </Link>
            ))}
            {match.family ? <span className="block">This number belongs to {match.family.guardianName} ({match.family.students.join(", ") || match.family.householdName})</span> : null}
          </p>
        ) : null}
        <Field label="Program" id="enq-program">
          <select id="enq-program" name="programId" value={programId} onChange={(e) => setProgramId(e.target.value)} required className={selectClass}>
            <option value="" disabled>
              Pick one
            </option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <details className="rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-label">More</summary>
          <div className="mt-3 flex flex-col gap-4">
            <Field label="Parent's name" id="enq-contact">
              <Input id="enq-contact" name="contactName" autoComplete="off" />
            </Field>
            <Field label="Source" id="enq-source">
              <select id="enq-source" name="source" defaultValue="" className={selectClass}>
                <option value="">—</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Batch" id="enq-batch">
              <select id="enq-batch" name="batchId" defaultValue="" className={selectClass}>
                <option value="">—</option>
                {batches
                  .filter((b) => b.programId === programId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Follow up on" id="enq-follow">
              <Input id="enq-follow" name="nextFollowUp" type="date" defaultValue={tomorrow} />
            </Field>
            <Field label="Assigned to" id="enq-owner">
              <select id="enq-owner" name="ownerStaffId" defaultValue={me} className={selectClass}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note" id="enq-notes">
              <textarea id="enq-notes" name="notes" rows={2} className="rounded-lg border border-border bg-background px-3 py-2 text-body" />
            </Field>
          </div>
        </details>
      </SheetForm>
    </Sheet>
  );
}
