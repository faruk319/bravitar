"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { formatPhone } from "@/lib/phone";
import type { HouseholdSuggestion } from "@/modules/students/service";

type Props = { id: string; name: string; phone: string; contactName: string | null; batches: { id: string; label: string }[]; batchId: string | null; today: string };

// docs/06 Prompt 18: one step, the phone carried forward; only what's missing is asked.
export function ConvertEnquiry({ id, name, phone, contactName, batches, batchId, today }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [adult, setAdult] = useState(false);
  const [family, setFamily] = useState<HouseholdSuggestion>();
  const [linkTo, setLinkTo] = useState<string>();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const body = {
      fullName: str("fullName"),
      adult,
      ...(adult ? {} : { guardian: { fullName: str("guardianName"), relation: str("relation") } }),
      dateOfBirth: str("dateOfBirth"),
      batchId: str("batchId"),
      startDate: str("startDate"),
      ...(linkTo ? { householdId: linkTo } : {}),
      consents: { dataProcessing: f.get("dataProcessing") === "on", photo: f.get("photo") === "on", whatsapp: f.get("whatsapp") === "on" },
    };
    setBusy(true);
    setError(undefined);
    const res = await fetch(`/api/enquiries/${id}/convert`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { studentId?: string; error?: string; details?: HouseholdSuggestion; issues?: { message: string }[] };
    setBusy(false);
    if (res.ok && out.studentId) return router.push(`/students/${out.studentId}`);
    if (res.status === 409 && out.details?.householdId) return setFamily(out.details);
    setError(out.issues?.[0]?.message ?? out.error ?? "Could not convert");
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button />}>Convert</SheetTrigger>
      <SheetForm trigger="Convert" title={`${name} joins`} submitLabel="Add student and enroll" busy={busy} error={error} onSubmit={(e) => void submit(e)}>
        <Field label="Student's name" id="cv-name">
          <Input id="cv-name" name="fullName" defaultValue={name} required />
        </Field>
        <p className="text-body">
          Phone <span className="font-medium tabular-nums">{formatPhone(phone)}</span>
        </p>
        <label className="flex min-h-10 items-center gap-3 text-body">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="size-5 accent-accent-600" />
          Adult, the phone is theirs
        </label>
        {adult ? null : (
          <>
            <Field label="Parent's name" id="cv-guardian">
              <Input id="cv-guardian" name="guardianName" defaultValue={contactName ?? ""} required autoComplete="off" />
            </Field>
            <Field label="Relation" id="cv-relation">
              <select id="cv-relation" name="relation" defaultValue="father" className={selectClass}>
                <option value="father">Father</option>
                <option value="mother">Mother</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </>
        )}
        {family ? (
          <div className="rounded-xl bg-neutral-50 p-3 text-body">
            This number belongs to <span className="font-medium">{family.guardianName}</span> ({family.householdName}
            {family.students.length ? ` · ${family.students.join(", ")}` : ""}).
            <Button type="button" size="sm" className="mt-2 block" variant={linkTo ? "default" : "outline"} onClick={() => setLinkTo(linkTo ? undefined : family.householdId)}>
              {linkTo ? "Added to this family" : "Add to this family"}
            </Button>
          </div>
        ) : null}
        <Field label="Date of birth (optional)" id="cv-dob">
          <Input id="cv-dob" name="dateOfBirth" type="date" />
        </Field>
        <Field label="Batch" id="cv-batch">
          <select id="cv-batch" name="batchId" defaultValue={batchId ?? batches[0]?.id ?? ""} className={selectClass}>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts on" id="cv-start">
          <Input id="cv-start" name="startDate" type="date" defaultValue={today} />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label">Consent</legend>
          <label className="flex min-h-10 items-center gap-3 text-body">
            <input type="checkbox" name="dataProcessing" required className="size-5" /> Data processing (required)
          </label>
          <label className="flex min-h-10 items-center gap-3 text-body">
            <input type="checkbox" name="whatsapp" className="size-5" /> WhatsApp messages
          </label>
          <label className="flex min-h-10 items-center gap-3 text-body">
            <input type="checkbox" name="photo" className="size-5" /> Photos
          </label>
        </fieldset>
      </SheetForm>
    </Sheet>
  );
}
