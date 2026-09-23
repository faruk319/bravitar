"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { useLabel } from "@/components/shell/tenant-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { CoachOption } from "@/modules/batches/repo";
import type { Slot } from "@/modules/batches/schedule";
import { Field } from "./batch-form";
import { fromSlots, ScheduleEditor, type ScheduleValue, toSlots } from "./schedule-editor";

type BatchLite = { id: string; name: string; branchId: string; status: string; startDate: string; coachId: string | null; resourceId: string | null; capacity: number | null; slots: Slot[] };

async function send(path: string, method: string, body?: unknown): Promise<string | undefined> {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (res.ok) return undefined;
  const b = (await res.json().catch(() => ({}))) as { error?: string; issues?: { message: string }[] };
  return b.issues?.[0]?.message ?? b.error ?? "Could not save";
}

function SheetForm({ trigger, title, children, onSubmit, submitLabel, busy, error, variant = "outline" }: { trigger: string; title: string; children: ReactNode; onSubmit: (e: FormEvent<HTMLFormElement>) => void; submitLabel: string; busy: boolean; error?: string | undefined; variant?: "outline" | "destructive" }) {
  return (
    <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
      <SheetTitle className="text-heading">{title}</SheetTitle>
      <form onSubmit={onSubmit} className="mt-4 flex max-w-md flex-col gap-4" noValidate>
        {children}
        {error ? (
          <p role="alert" className="text-label text-danger-600">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" variant={variant === "destructive" ? "destructive" : "default"} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </form>
      <span className="sr-only">{trigger}</span>
    </SheetContent>
  );
}

function useAction() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (fn: () => Promise<string | undefined>, after?: () => void) => {
    setBusy(true);
    setError(undefined);
    const err = await fn();
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    if (after) after();
    else router.refresh();
  };
  return { open, setOpen, busy, error, run, router };
}

export function ChangeTiming({ batch, today }: { batch: BatchLite; today: string }) {
  const a = useAction();
  const [value, setValue] = useState<ScheduleValue>(fromSlots(batch.slots));
  const started = batch.startDate <= today;
  return (
    <Sheet open={a.open} onOpenChange={(o) => { a.setOpen(o); if (o) setValue(fromSlots(batch.slots)); }}>
      <SheetTrigger render={<Button variant="outline" />}>Change timing</SheetTrigger>
      <SheetForm
        trigger="Change timing"
        title="Change timing"
        submitLabel="Save timing"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const from = new FormData(e.currentTarget).get("from") as string | null;
          void a.run(() => send(`/api/batches/${batch.id}/schedule`, "POST", { slots: toSlots(value), ...(from ? { from } : {}) }));
        }}
      >
        <ScheduleEditor value={value} onChange={setValue} />
        {started ? (
          <Field label="From" id="from">
            <Input id="from" name="from" type="date" defaultValue={today} min={today} />
          </Field>
        ) : null}
      </SheetForm>
    </Sheet>
  );
}

export function EditBatch({ batch, coaches, rooms }: { batch: BatchLite; coaches: CoachOption[]; rooms: { id: string; name: string; branchId: string }[] }) {
  const a = useAction();
  const staff = useLabel("staff");
  const branchCoaches = coaches.filter((c) => !c.branchIds.length || c.branchIds.includes(batch.branchId));
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Edit</SheetTrigger>
      <SheetForm
        trigger="Edit"
        title={`Edit ${batch.name}`}
        submitLabel="Save"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const str = (k: string) => ((f.get(k) as string | null) ?? "").trim();
          const capacity = str("capacity");
          void a.run(() => send(`/api/batches/${batch.id}`, "PATCH", { name: str("name"), coachId: str("coachId") || null, resourceId: str("resourceId") || null, capacity: capacity ? Number(capacity) : null }));
        }}
      >
        <Field label="Name" id="name">
          <Input id="name" name="name" defaultValue={batch.name} required />
        </Field>
        <Field label={staff} id="coachId">
          <select id="coachId" name="coachId" defaultValue={batch.coachId ?? ""} className="h-12 rounded-lg border border-border bg-background px-3 text-body">
            <option value="">Not decided</option>
            {branchCoaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Capacity" id="capacity">
            <Input id="capacity" name="capacity" type="number" inputMode="numeric" min={1} defaultValue={batch.capacity ?? ""} placeholder="No limit" />
          </Field>
          <Field label="Room" id="resourceId">
            <select id="resourceId" name="resourceId" defaultValue={batch.resourceId ?? ""} className="h-12 rounded-lg border border-border bg-background px-3 text-body">
              <option value="">—</option>
              {rooms
                .filter((r) => r.branchId === batch.branchId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      </SheetForm>
    </Sheet>
  );
}

export function CloseOrReopen({ batch, today }: { batch: BatchLite; today: string }) {
  const a = useAction();
  if (batch.status === "ended") {
    return (
      <Button variant="outline" disabled={a.busy} onClick={() => void a.run(() => send(`/api/batches/${batch.id}/status`, "POST", { action: "reopen" }))}>
        Reopen
      </Button>
    );
  }
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Close</SheetTrigger>
      <SheetForm
        trigger="Close"
        title={`Close ${batch.name}`}
        submitLabel="Close batch"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const endDate = new FormData(e.currentTarget).get("endDate") as string | null;
          void a.run(() => send(`/api/batches/${batch.id}/status`, "POST", { action: "close", ...(endDate ? { endDate } : {}) }));
        }}
      >
        <Field label="Last day" id="endDate">
          <Input id="endDate" name="endDate" type="date" defaultValue={today} min={batch.startDate} />
        </Field>
      </SheetForm>
    </Sheet>
  );
}

export function DeleteBatch({ batch }: { batch: BatchLite }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="ghost" className="text-danger-600" />}>Delete</SheetTrigger>
      <SheetForm
        trigger="Delete"
        title={`Delete ${batch.name}?`}
        submitLabel="Delete"
        variant="destructive"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(
            () => send(`/api/batches/${batch.id}`, "DELETE"),
            () => a.router.push("/batches"),
          );
        }}
      >
        <p className="text-body text-muted-foreground">Only for a batch made by mistake. A batch with students can only be closed.</p>
      </SheetForm>
    </Sheet>
  );
}
