"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Field } from "@/components/sheet-form";
import { useBranch, useLabel } from "@/components/shell/tenant-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CoachOption } from "@/modules/batches/repo";
import { emptySchedule, ScheduleEditor, type ScheduleValue, toSlots } from "./schedule-editor";

const NEW = "__new";
const selectClass = "h-12 rounded-lg border border-border bg-background px-3 text-body";

// New students get this plan; each student's can be changed on their page.
export function FeePlanField({ plans, value }: { plans: { id: string; name: string }[]; value?: string | null }) {
  return (
    <Field label="Fee plan" id="defaultFeePlanId">
      <select id="defaultFeePlanId" name="defaultFeePlanId" defaultValue={value ?? ""} className={selectClass}>
        <option value="">None</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

// docs/06 Prompt 8: name, program, days, time, coach, start date on one
// screen, in under a minute. Capacity and room are optional extras below.
export function BatchForm({ programs, coaches, rooms, plans, canAddProgram, today }: { programs: { id: string; name: string }[]; coaches: CoachOption[]; rooms: { id: string; name: string; branchId: string }[]; plans: { id: string; name: string }[]; canAddProgram: boolean; today: string }) {
  const router = useRouter();
  const { branches, currentBranchId } = useBranch();
  const batch = useLabel("batch");
  const program = useLabel("program");
  const staff = useLabel("staff");
  const [branchId, setBranchId] = useState(currentBranchId !== "all" ? currentBranchId : (branches[0]?.id ?? ""));
  const [programChoice, setProgramChoice] = useState(programs[0]?.id ?? (canAddProgram ? NEW : ""));
  const [schedule, setSchedule] = useState<ScheduleValue>(emptySchedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const branchCoaches = coaches.filter((c) => !c.branchIds.length || c.branchIds.includes(branchId));
  const branchRooms = rooms.filter((r) => r.branchId === branchId);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const f = new FormData(e.currentTarget);
    const str = (k: string) => ((f.get(k) as string | null) ?? "").trim();
    const capacity = str("capacity");
    const res = await fetch("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: str("name"),
        ...(programChoice === NEW ? { newProgramName: str("newProgram") } : { programId: programChoice }),
        ...(branchId ? { branchId } : {}),
        coachId: str("coachId") || null,
        resourceId: str("resourceId") || null,
        capacity: capacity ? Number(capacity) : null,
        defaultFeePlanId: str("defaultFeePlanId") || null,
        startDate: str("startDate") || today,
        slots: toSlots(schedule),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string; issues?: { message: string }[] };
    if (res.status === 201 && body.id) {
      router.push(`/batches/${body.id}`);
      return;
    }
    setError(body.issues?.[0]?.message ?? body.error ?? "Could not save");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
      <Field label={`${batch} name`} id="name">
        <Input id="name" name="name" autoFocus required placeholder="e.g. Beginners B" autoComplete="off" />
      </Field>

      <Field label={program} id="program">
        {programs.length ? (
          <select id="program" value={programChoice} onChange={(e) => setProgramChoice(e.target.value)} className={selectClass}>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {canAddProgram ? <option value={NEW}>+ New {program.toLowerCase()}…</option> : null}
          </select>
        ) : null}
        {programChoice === NEW ? <Input id={programs.length ? "newProgram" : "program"} name="newProgram" required placeholder="e.g. Karate" aria-label={`New ${program.toLowerCase()}`} /> : null}
      </Field>

      <ScheduleEditor value={schedule} onChange={setSchedule} />

      <Field label={staff} id="coachId">
        <select id="coachId" name="coachId" defaultValue="" className={selectClass}>
          <option value="">Not decided</option>
          {branchCoaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.fullName}
            </option>
          ))}
        </select>
      </Field>

      {plans.length ? <FeePlanField plans={plans} /> : null}

      <Field label="Starts on" id="startDate">
        <Input id="startDate" name="startDate" type="date" defaultValue={today} />
      </Field>

      {branches.length > 1 ? (
        <Field label="Branch" id="branch">
          <select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className={selectClass}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Capacity" id="capacity">
          <Input id="capacity" name="capacity" type="number" inputMode="numeric" min={1} placeholder="No limit" />
        </Field>
        <Field label="Room" id="resourceId">
          <select id="resourceId" name="resourceId" defaultValue="" className={selectClass} key={branchId}>
            <option value="">—</option>
            {branchRooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Saving…" : `Add ${batch.toLowerCase()}`}
      </Button>
    </form>
  );
}
