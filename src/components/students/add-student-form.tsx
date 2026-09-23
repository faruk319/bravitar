"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useBranch, useLabel } from "@/components/shell/tenant-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Suggestion = { householdId: string; householdName: string; guardianName: string; students: string[] };

// One column, labels above, phone keypad for phones, submit under the fields
// (docs/07 §6). Target: done in under 60 seconds (docs/03 §3).
export function AddStudentForm() {
  const router = useRouter();
  const { branches, currentBranchId } = useBranch();
  const student = useLabel("student");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [suggestion, setSuggestion] = useState<Suggestion | undefined>();
  const [linkTo, setLinkTo] = useState<string | undefined>();

  async function onPhoneBlur(phone: string) {
    if (phone.replace(/\D/g, "").length < 10) return;
    const res = await fetch(`/api/guardians/lookup?phone=${encodeURIComponent(phone)}`);
    const body = (await res.json()) as { found: Suggestion | null };
    setSuggestion(body.found ?? undefined);
    setLinkTo(undefined);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string | null)?.trim() || undefined;
    const payload = {
      fullName: str("fullName"),
      dateOfBirth: str("dateOfBirth"),
      gender: str("gender"),
      programInterest: str("programInterest"),
      branchId: str("branchId") ?? (currentBranchId !== "all" ? currentBranchId : undefined),
      ...(adult
        ? { adultPhone: str("adultPhone") }
        : { guardian: { fullName: str("guardianName"), phone: str("guardianPhone"), relation: str("relation") ?? "father" } }),
      ...(linkTo ? { householdId: linkTo } : {}),
      consents: { dataProcessing: f.get("dataProcessing") === "on", photo: f.get("photo") === "on" },
    };
    const res = await fetch("/api/students", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: Suggestion; student?: { id: string } };
    if (res.status === 201 && body.student) {
      router.push(`/students/${body.student.id}`);
      return;
    }
    if (res.status === 409 && body.details?.householdId) {
      setSuggestion(body.details);
      setError(undefined);
    } else {
      setError(body.error ?? "Could not save");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4" noValidate>
      <Field label={`${student} name`} htmlFor="fullName">
        <Input id="fullName" name="fullName" autoFocus required autoComplete="off" />
      </Field>
      <Field label="Date of birth" htmlFor="dateOfBirth">
        <Input id="dateOfBirth" name="dateOfBirth" type="date" />
      </Field>
      <Field label="Gender" htmlFor="gender">
        <select id="gender" name="gender" className="h-12 rounded-lg border border-border bg-background px-3 text-body">
          <option value="">—</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </Field>

      <label className="flex min-h-12 items-center gap-3 text-body">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="size-5" />
        Adult, own contact
      </label>

      {adult ? (
        <Field label="Phone" htmlFor="adultPhone">
          <Input id="adultPhone" name="adultPhone" type="tel" inputMode="tel" autoComplete="tel" required onBlur={(e) => onPhoneBlur(e.target.value)} />
        </Field>
      ) : (
        <>
          <Field label="Parent / guardian name" htmlFor="guardianName">
            <Input id="guardianName" name="guardianName" required autoComplete="off" />
          </Field>
          <Field label="Guardian phone" htmlFor="guardianPhone">
            <Input id="guardianPhone" name="guardianPhone" type="tel" inputMode="tel" required onBlur={(e) => onPhoneBlur(e.target.value)} />
          </Field>
          <Field label="Relation" htmlFor="relation">
            <select id="relation" name="relation" className="h-12 rounded-lg border border-border bg-background px-3 text-body">
              <option value="father">Father</option>
              <option value="mother">Mother</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </>
      )}

      {suggestion ? (
        <div className="rounded-xl bg-neutral-50 p-4">
          <p className="text-body">
            This number belongs to <span className="font-medium">{suggestion.guardianName}</span> ({suggestion.householdName}
            {suggestion.students.length ? ` · ${suggestion.students.join(", ")}` : ""}).
          </p>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" variant={linkTo ? "default" : "outline"} onClick={() => setLinkTo(suggestion.householdId)}>
              {linkTo ? "Linked to this family" : "Link to this family"}
            </Button>
            {linkTo ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setLinkTo(undefined)}>
                Undo
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Field label="Interested in" htmlFor="programInterest">
        <Input id="programInterest" name="programInterest" placeholder="e.g. Beginners, Class 9 Maths" />
      </Field>

      {branches.length > 1 ? (
        <Field label="Branch" htmlFor="branchId">
          <select id="branchId" name="branchId" defaultValue={currentBranchId === "all" ? "" : currentBranchId} className="h-12 rounded-lg border border-border bg-background px-3 text-body">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-label">Consent</legend>
        <label className="flex min-h-12 items-center gap-3 text-body">
          <input type="checkbox" name="dataProcessing" required className="size-5" /> Data processing (required)
        </label>
        <label className="flex min-h-12 items-center gap-3 text-body">
          <input type="checkbox" name="photo" className="size-5" /> Photos
        </label>
      </fieldset>

      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Saving…" : `Add ${student}`}
      </Button>
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
