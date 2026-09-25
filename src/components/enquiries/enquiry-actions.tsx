"use client";

import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { send } from "@/lib/send";
import { LOST_REASON_LABELS, LOST_REASONS, SOURCE_LABELS, SOURCES } from "@/modules/enquiries/lists";
import type { EnquiryRow } from "@/modules/enquiries/repo";
import type { BatchOption, Option } from "./add-enquiry";

const areaClass = "rounded-lg border border-border bg-background px-3 py-2 text-body";
const KINDS = [
  ["call", "Call"],
  ["whatsapp", "WhatsApp"],
  ["visit", "Visit"],
  ["note", "Note"],
] as const;

// A call, message, visit or note, and when to follow up next.
export function LogActivity({ id, nextFollowUp }: { id: string; nextFollowUp: string }) {
  const a = useAction();
  const [done, setDone] = useState(false);
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button />}>Log</SheetTrigger>
      <SheetForm
        trigger="Log"
        title="Log what happened"
        submitLabel="Save"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const next = String(f.get("nextFollowUp") ?? "");
          void a.run(() => send(`/api/enquiries/${id}/activity`, "POST", { kind: f.get("kind"), note: String(f.get("note") ?? "").trim() || undefined, nextFollowUp: done ? null : next || undefined }));
        }}
      >
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">What</legend>
          {KINDS.map(([k, label], i) => (
            <label key={k} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-border px-3 has-checked:border-accent-600 has-checked:bg-accent-50">
              <input type="radio" name="kind" value={k} defaultChecked={i === 0} className="accent-accent-600" />
              {label}
            </label>
          ))}
        </fieldset>
        <Field label="Note" id="act-note">
          <textarea id="act-note" name="note" rows={3} className={areaClass} />
        </Field>
        <Field label="Follow up on" id="act-next">
          <Input id="act-next" name="nextFollowUp" type="date" defaultValue={nextFollowUp} disabled={done} />
        </Field>
        <label className="flex items-center gap-2 text-label">
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="size-5 accent-accent-600" />
          No more follow-ups
        </label>
      </SheetForm>
    </Sheet>
  );
}

export function EditEnquiry({ e, programs, batches, staff }: { e: EnquiryRow; programs: Option[]; batches: BatchOption[]; staff: Option[] }) {
  const a = useAction();
  const [programId, setProgramId] = useState(e.programId ?? "");
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Edit</SheetTrigger>
      <SheetForm
        trigger="Edit"
        title={`Edit ${e.name}`}
        submitLabel="Save"
        busy={a.busy}
        error={a.error}
        onSubmit={(ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          const val = (k: string) => String(f.get(k) ?? "").trim();
          void a.run(() =>
            send(`/api/enquiries/${e.id}`, "PATCH", {
              name: val("name"),
              phone: val("phone"),
              contactName: val("contactName") || null,
              programId: val("programId"),
              batchId: val("batchId") || null,
              source: val("source") || null,
              ownerStaffId: val("ownerStaffId"),
              nextFollowUp: val("nextFollowUp") || null,
              notes: val("notes") || null,
            }),
          );
        }}
      >
        <Field label="Student's name" id="ed-name">
          <Input id="ed-name" name="name" defaultValue={e.name} required />
        </Field>
        <Field label="Phone" id="ed-phone">
          <Input id="ed-phone" name="phone" type="tel" defaultValue={e.phone} required />
        </Field>
        <Field label="Parent's name" id="ed-contact">
          <Input id="ed-contact" name="contactName" defaultValue={e.contactName ?? ""} />
        </Field>
        <Field label="Program" id="ed-program">
          <select id="ed-program" name="programId" value={programId} onChange={(ev) => setProgramId(ev.target.value)} className={selectClass}>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Batch" id="ed-batch">
          <select id="ed-batch" name="batchId" defaultValue={e.batchId ?? ""} className={selectClass}>
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
        <Field label="Source" id="ed-source">
          <select id="ed-source" name="source" defaultValue={e.source ?? ""} className={selectClass}>
            <option value="">—</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assigned to" id="ed-owner">
          <select id="ed-owner" name="ownerStaffId" defaultValue={e.ownerStaffId ?? ""} className={selectClass}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Follow up on" id="ed-next">
          <Input id="ed-next" name="nextFollowUp" type="date" defaultValue={e.nextFollowUp ?? ""} />
        </Field>
        <Field label="Note" id="ed-notes">
          <textarea id="ed-notes" name="notes" rows={2} defaultValue={e.notes ?? ""} className={areaClass} />
        </Field>
      </SheetForm>
    </Sheet>
  );
}

// docs/03 §4: a reason from the fixed list, plus an optional note.
export function MarkLost({ id }: { id: string }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="ghost" className="text-danger-600" />}>Mark lost</SheetTrigger>
      <SheetForm
        trigger="Mark lost"
        title="Why was this enquiry lost?"
        submitLabel="Mark lost"
        variant="destructive"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(() => send(`/api/enquiries/${id}/lost`, "POST", { reason: f.get("reason") || undefined, note: String(f.get("note") ?? "").trim() || undefined }));
        }}
      >
        <Field label="Reason" id="lost-reason">
          <select id="lost-reason" name="reason" defaultValue="" required className={selectClass}>
            <option value="" disabled>
              Pick one
            </option>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {LOST_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note (optional)" id="lost-note">
          <Input id="lost-note" name="note" autoComplete="off" />
        </Field>
      </SheetForm>
    </Sheet>
  );
}

export function Reopen({ id }: { id: string }) {
  const a = useAction();
  return (
    <>
      <Button variant="outline" disabled={a.busy} onClick={() => void a.run(() => send(`/api/enquiries/${id}/reopen`, "POST"))}>
        {a.busy ? "Reopening…" : "Reopen"}
      </Button>
      {a.error ? (
        <p role="alert" className="text-label text-danger-600">
          {a.error}
        </p>
      ) : null}
    </>
  );
}

export type TrialOption = { id: string; name: string; classes: { sessionId: string; label: string }[] };

// docs/03 §4: a trial in one of a batch's next classes.
export function BookTrial({ id, batches }: { id: string; batches: TrialOption[] }) {
  const a = useAction();
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const classes = batches.find((b) => b.id === batchId)?.classes ?? [];
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>Book trial</SheetTrigger>
      <SheetForm
        trigger="Book trial"
        title="Book a trial class"
        submitLabel="Book"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(() => send(`/api/enquiries/${id}/trials`, "POST", { sessionId: f.get("sessionId") || undefined }));
        }}
      >
        <Field label="Batch" id="trial-batch">
          <select id="trial-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={selectClass}>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label">Class</legend>
          {classes.map((c, i) => (
            <label key={c.sessionId} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 has-checked:border-accent-600 has-checked:bg-accent-50">
              <input type="radio" name="sessionId" value={c.sessionId} defaultChecked={i === 0} className="accent-accent-600" />
              {c.label}
            </label>
          ))}
        </fieldset>
      </SheetForm>
    </Sheet>
  );
}

export function CancelTrial({ trialId }: { trialId: string }) {
  const a = useAction();
  return (
    <Button variant="ghost" size="sm" disabled={a.busy} onClick={() => void a.run(() => send(`/api/enquiries/trials/${trialId}/cancel`, "POST"))}>
      {a.busy ? "Cancelling…" : "Cancel"}
    </Button>
  );
}
