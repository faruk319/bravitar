"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { request } from "@/lib/send";
import { CheckList, type Option } from "./check-list";
import { InviteLink } from "./invite-link";

export function AddStaff({ roles, branches }: { roles: Option[]; branches: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ token: string; name: string }>();
  const [branchIds, setBranchIds] = useState<string[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { fullName: f.get("fullName"), email: f.get("email"), ...(f.get("phone") ? { phone: f.get("phone") } : {}), roleId: f.get("roleId"), branchIds };
    setBusy(true);
    const r = await request<{ token: string }>("/api/staff", "POST", body);
    setBusy(false);
    if (r.error !== undefined) return setError(r.error);
    setDone({ token: r.data.token, name: String(body.fullName) });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && done) router.refresh();
        if (o) {
          setDone(undefined);
          setError(undefined);
          setBranchIds([]);
        }
      }}
    >
      <SheetTrigger render={<Button size="lg" />}>Add staff</SheetTrigger>
      <SheetContent side="auto">
        <SheetTitle className="text-heading">{done ? "Invite link" : "Add staff"}</SheetTitle>
        {done ? (
          <div className="mt-4 flex max-w-md flex-col gap-4">
            <InviteLink token={done.token} name={done.name} />
            <Button
              size="lg"
              onClick={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 flex max-w-md flex-col gap-4" noValidate>
            <Field label="Name" id="fullName">
              <Input id="fullName" name="fullName" required autoFocus />
            </Field>
            <Field label="Email" id="email">
              <Input id="email" name="email" type="email" required />
            </Field>
            <Field label="Phone" id="phone">
              <Input id="phone" name="phone" type="tel" inputMode="tel" />
            </Field>
            <Field label="Role" id="roleId">
              <select id="roleId" name="roleId" required defaultValue="" className={selectClass}>
                <option value="" disabled>
                  Pick a role
                </option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span className="text-caption text-muted-foreground">Permissions come from the role.</span>
            </Field>
            {branches.length > 1 ? <CheckList legend="Branches (none = all)" options={branches} value={branchIds} onChange={setBranchIds} /> : null}
            {error ? (
              <p role="alert" className="text-label text-danger-600">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Saving…" : "Add and get link"}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
