"use client";

import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { addDays } from "@/lib/dates";
import { send } from "@/lib/send";

export type BatchChoice = { id: string; label: string };

function BatchSelect({ id, choices }: { id: string; choices: BatchChoice[] }) {
  return (
    <Field label="Batch" id={id}>
      <select id={id} name="batchId" className="h-12 rounded-lg border border-border bg-background px-3 text-body">
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

// Student page path.
export function JoinBatch({ studentId, choices, today }: { studentId: string; choices: BatchChoice[]; today: string }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Join a batch</SheetTrigger>
      <SheetForm
        trigger="Join a batch"
        title="Join a batch"
        submitLabel="Join"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(() => send("/api/enrollments", "POST", { studentId, batchId: f.get("batchId"), startDate: f.get("startDate") }));
        }}
      >
        <BatchSelect id="join-batch" choices={choices} />
        <Field label="Joining from" id="join-from">
          <Input id="join-from" name="startDate" type="date" defaultValue={today} />
        </Field>
      </SheetForm>
    </Sheet>
  );
}

// Applies from the next charge; an archived plan stays listed while it's in use.
export function PlanSelect({ enrollmentId, current, plans }: { enrollmentId: string; current: { id: string; name: string } | null; plans: { id: string; name: string }[] }) {
  const a = useAction();
  const options = current && !plans.some((p) => p.id === current.id) ? [current, ...plans] : plans;
  return (
    <label className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
      Fee plan
      <select
        defaultValue={current?.id ?? ""}
        disabled={a.busy}
        onChange={(e) => void a.run(() => send(`/api/enrollments/${enrollmentId}`, "POST", { action: "plan", feePlanId: e.target.value || null }))}
        className="h-10 rounded-lg border border-border bg-background px-2 text-label text-foreground"
      >
        <option value="">None</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {a.error ? (
        <span role="alert" className="text-danger-600">
          {a.error}
        </span>
      ) : null}
    </label>
  );
}

type Current = { id: string; status: string; batchId: string; startDate: string };

export function EnrollmentActions({ enrollment: e, choices, today }: { enrollment: Current; choices: BatchChoice[]; today: string }) {
  const pause = useAction();
  const move = useAction();
  const leave = useAction();
  const post = (body: object) => send(`/api/enrollments/${e.id}`, "POST", body);
  const targets = choices.filter((c) => c.id !== e.batchId);
  const date = (f: HTMLFormElement) => new FormData(f).get("date");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pause.busy} onClick={() => void pause.run(() => post({ action: e.status === "paused" ? "resume" : "pause" }))}>
        {e.status === "paused" ? "Resume" : "Pause"}
      </Button>
      {targets.length ? (
        <Sheet open={move.open} onOpenChange={move.setOpen}>
          <SheetTrigger render={<Button size="sm" variant="outline" />}>Move</SheetTrigger>
          <SheetForm
            trigger="Move"
            title="Move to another batch"
            submitLabel="Move"
            busy={move.busy}
            error={move.error}
            onSubmit={(ev) => {
              ev.preventDefault();
              const batchId = new FormData(ev.currentTarget).get("batchId");
              void move.run(() => post({ action: "transfer", batchId, date: date(ev.currentTarget) }));
            }}
          >
            <BatchSelect id={`${e.id}-to`} choices={targets} />
            <Field label="From" id={`${e.id}-from`}>
              <Input id={`${e.id}-from`} name="date" type="date" defaultValue={today < e.startDate ? e.startDate : today} min={e.startDate} />
            </Field>
          </SheetForm>
        </Sheet>
      ) : null}
      <Sheet open={leave.open} onOpenChange={leave.setOpen}>
        <SheetTrigger render={<Button size="sm" variant="ghost" className="text-danger-600" />}>Leave</SheetTrigger>
        <SheetForm
          trigger="Leave"
          title="Leave this batch"
          submitLabel="Leave batch"
          variant="destructive"
          busy={leave.busy}
          error={leave.error}
          onSubmit={(ev) => {
            ev.preventDefault();
            void leave.run(() => post({ action: "leave", date: date(ev.currentTarget) }));
          }}
        >
          <Field label="Last day" id={`${e.id}-last`}>
            <Input id={`${e.id}-last`} name="date" type="date" defaultValue={today < e.startDate ? addDays(e.startDate, -1) : today} min={addDays(e.startDate, -1)} />
          </Field>
        </SheetForm>
      </Sheet>
      {pause.error ? (
        <p role="alert" className="text-label text-danger-600">
          {pause.error}
        </p>
      ) : null}
    </div>
  );
}
