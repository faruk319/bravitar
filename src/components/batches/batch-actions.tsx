"use client";

import { useState } from "react";
import { useLabel } from "@/components/shell/tenant-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { send } from "@/lib/send";
import type { CoachOption } from "@/modules/batches/repo";
import type { Slot } from "@/modules/batches/schedule";
import { fromSlots, ScheduleEditor, type ScheduleValue, toSlots } from "./schedule-editor";

type BatchLite = { id: string; name: string; branchId: string; status: string; startDate: string; coachId: string | null; resourceId: string | null; capacity: number | null; slots: Slot[] };

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
