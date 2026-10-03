"use client";

import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { send } from "@/lib/send";
import { FAMILY_ACCESS, FAMILY_ACCESS_LABELS, type FamilyAccess } from "@/modules/portal/access";
import { FAMILY_RELATIONS, RELATION_LABELS } from "@/modules/students/relations";

// A family member gets access to this student (agreed 2026-10-03); signing
// in with the WhatsApp code counts as accepting.
export function AddFamilyMember({ studentId }: { studentId: string }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" className="mt-2 self-start" />}>Add family member</SheetTrigger>
      <SheetForm
        trigger="Add family member"
        title="Add family member"
        submitLabel="Add"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(() => send(`/api/students/${studentId}/family`, "POST", { fullName: f.get("fullName"), phone: f.get("phone"), relation: f.get("relation") }));
        }}
      >
        <Field label="Name" id="family-name">
          <Input id="family-name" name="fullName" required autoComplete="off" />
        </Field>
        <Field label="Phone" id="family-phone">
          <Input id="family-phone" name="phone" type="tel" inputMode="tel" required />
        </Field>
        <Field label="Relation" id="family-relation">
          <select id="family-relation" name="relation" defaultValue="mother" className={selectClass}>
            {FAMILY_RELATIONS.map((r) => (
              <option key={r} value={r}>
                {RELATION_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
      </SheetForm>
    </Sheet>
  );
}

// Make them the manager; remove their access (tap again to confirm).
export function FamilyMemberActions({ studentId, guardianId, removable }: { studentId: string; guardianId: string; removable: boolean }) {
  const a = useAction();
  const [confirm, setConfirm] = useState(false);
  const path = `/api/students/${studentId}/family/${guardianId}`;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" disabled={a.busy} onClick={() => void a.run(() => send(path, "PATCH", { manager: true }))}>
        Make manager
      </Button>
      {removable ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-danger-600"
          disabled={a.busy}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            void a.run(() => send(path, "DELETE"));
          }}
        >
          {confirm ? "Tap again to remove" : "Remove access"}
        </Button>
      ) : null}
      {a.error ? (
        <span role="alert" className="text-caption text-danger-600">
          {a.error}
        </span>
      ) : null}
    </span>
  );
}

// Settings: what family members who aren't a student's manager see in the portal.
export function FamilyAccessSettings({ value }: { value: FamilyAccess[] }) {
  const a = useAction();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex max-w-md flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setSaved(false);
        void a.run(
          () => send("/api/settings/family-access", "PATCH", { keys: FAMILY_ACCESS.filter((k) => f.get(k) === "on") }),
          () => {
            setSaved(true);
            a.router.refresh();
          },
        );
      }}
    >
      <p className="text-caption text-muted-foreground">For family members who aren&apos;t the student&apos;s manager. The manager sees everything.</p>
      {FAMILY_ACCESS.map((k) => (
        <label key={k} className="flex min-h-11 items-center gap-3 text-body">
          <input type="checkbox" name={k} defaultChecked={value.includes(k)} className="size-5 accent-accent-600" /> {FAMILY_ACCESS_LABELS[k]}
        </label>
      ))}
      {a.error ? (
        <p role="alert" className="text-label text-danger-600">
          {a.error}
        </p>
      ) : null}
      <div className="mt-1 flex items-center gap-3">
        <Button type="submit" variant="outline" size="lg" disabled={a.busy}>
          Save
        </Button>
        {saved ? <span className="text-label text-success-600">✓ Saved</span> : null}
      </div>
    </form>
  );
}
