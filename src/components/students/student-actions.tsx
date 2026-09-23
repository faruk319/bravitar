"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { send } from "@/lib/send";
import { LEFT_REASON_LABELS, LEFT_REASONS, type Student } from "@/modules/students/schema";

// Pause / resume are one tap and undoable; leaving needs a reason (docs/03 §3).
export function StatusActions({ student, canUpdate }: { student: Student; canUpdate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!canUpdate) return null;
  const set = async (body: unknown) => {
    setBusy(true);
    const err = await send(`/api/students/${student.id}/status`, "POST", body);
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
  };
  async function leave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await set({ status: "left", reason: f.get("reason"), note: (f.get("note") as string) || undefined });
  }
  return (
    <div className="flex flex-wrap gap-2">
      {student.status === "active" ? (
        <Button variant="outline" disabled={busy} onClick={() => set({ status: "paused" })}>
          Pause
        </Button>
      ) : null}
      {student.status === "paused" || student.status === "left" ? (
        <Button variant="outline" disabled={busy} onClick={() => set({ status: "active" })}>
          {student.status === "left" ? "Rejoin" : "Resume"}
        </Button>
      ) : null}
      {student.status !== "left" ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={<Button variant="outline" />}>Mark as left</SheetTrigger>
          <SheetContent side="auto">
            <SheetTitle className="text-heading">Why is {student.fullName} leaving?</SheetTitle>
            <form onSubmit={leave} className="mt-4 flex flex-col gap-3">
              <div className="grid gap-1">
                {LEFT_REASONS.map((r) => (
                  <label key={r} className="flex min-h-12 items-center gap-3 rounded-lg px-2 text-body hover:bg-neutral-50">
                    <input type="radio" name="reason" value={r} required className="size-5" /> {LEFT_REASON_LABELS[r]}
                  </label>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="note">Note</Label>
                <Input id="note" name="note" placeholder="Needed for Other" />
              </div>
              {error ? <p role="alert" className="text-label text-danger-600">{error}</p> : null}
              <Button type="submit" size="lg" disabled={busy}>
                Mark as left
              </Button>
            </form>
          </SheetContent>
        </Sheet>
      ) : null}
      {error && !open ? <p role="alert" className="w-full text-label text-danger-600">{error}</p> : null}
    </div>
  );
}

export function EditStudentSheet({ student, canUpdate }: { student: Student; canUpdate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!canUpdate) return null;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string | null)?.trim() ?? "";
    let err = await send(`/api/students/${student.id}`, "PATCH", {
      fullName: str("fullName"),
      dateOfBirth: str("dateOfBirth") || null,
      gender: str("gender") || null,
      programInterest: str("programInterest") || null,
    });
    const code = str("code").toUpperCase();
    if (!err && !student.codeEditedAt && code && code !== student.code) err = await send(`/api/students/${student.id}`, "PATCH", { code });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Edit</SheetTrigger>
      <SheetContent side="auto">
        <SheetTitle className="text-heading">Edit {student.fullName}</SheetTitle>
        <form onSubmit={save} className="mt-4 flex flex-col gap-3">
          <F label="Name" id="fullName"><Input id="fullName" name="fullName" defaultValue={student.fullName} required /></F>
          <F label="Date of birth" id="dateOfBirth"><Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={student.dateOfBirth ?? ""} /></F>
          <F label="Gender" id="gender">
            <select id="gender" name="gender" defaultValue={student.gender ?? ""} className="h-12 rounded-lg border border-border bg-background px-3 text-body">
              <option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
            </select>
          </F>
          <F label="Interested in" id="programInterest"><Input id="programInterest" name="programInterest" defaultValue={student.metadata.programInterest ?? ""} /></F>
          <F label={student.codeEditedAt ? "Code (locked)" : "Code (can be changed once)"} id="code">
            <Input id="code" name="code" defaultValue={student.code} disabled={Boolean(student.codeEditedAt)} className="uppercase tabular-nums" />
          </F>
          {error ? <p role="alert" className="text-label text-danger-600">{error}</p> : null}
          <Button type="submit" size="lg" disabled={busy}>Save</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function PhotoConsentToggle({ studentId, granted, canUpdate }: { studentId: string; granted: boolean; canUpdate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex min-h-12 items-center gap-3 text-body">
      <input
        type="checkbox"
        className="size-5"
        checked={granted}
        disabled={!canUpdate || busy}
        onChange={async (e) => {
          setBusy(true);
          await send(`/api/students/${studentId}/consents`, "POST", { kind: "photo", granted: e.target.checked });
          setBusy(false);
          router.refresh();
        }}
      />
      Photos allowed
    </label>
  );
}

function F({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
