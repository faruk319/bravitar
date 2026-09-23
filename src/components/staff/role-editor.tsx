"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { request, send } from "@/lib/send";
import { CheckList, type Option } from "./check-list";

export type PermissionGroup = { module: string; label: string; off: boolean; options: Option[] };

// Tick and save (agreed 2026-09-23). Changes reach holders on their next page.
export function RoleEditor({ roleId, name, keys, holders, groups }: { roleId: string; name: string; keys: string[]; holders: number; groups: PermissionGroup[] }) {
  const router = useRouter();
  const [ticked, setTicked] = useState(keys);
  const [title, setTitle] = useState(name);
  const [msg, setMsg] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = async (body: object) => {
    const err = await send(`/api/roles/${roleId}`, "PATCH", body);
    setMsg(err ?? "Saved ✓");
    if (!err) router.refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name" id="role-name">
          <Input id="role-name" value={title} onChange={(e) => setTitle(e.target.value)} className="w-64" />
        </Field>
        <Button variant="outline" onClick={() => save({ name: title })} disabled={title.trim() === name}>
          Rename
        </Button>
      </div>
      {groups.map((g) => (
        <div key={g.module} className={g.off ? "opacity-60" : undefined}>
          <CheckList
            legend={g.off ? `${g.label} · off for this academy` : g.label}
            options={g.options}
            value={ticked.filter((k) => g.options.some((o) => o.id === k))}
            onChange={(ids) => setTicked([...ticked.filter((k) => !g.options.some((o) => o.id === k)), ...ids])}
          />
        </div>
      ))}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-neutral-100 bg-card px-4 py-3 md:-mx-5 md:px-5">
        <Button size="lg" onClick={() => save({ keys: ticked })}>
          Save permissions
        </Button>
        {msg ? <span className={msg === "Saved ✓" ? "text-label text-success-600" : "text-label text-danger-600"}>{msg}</span> : null}
        {holders === 0 ? (
          <Button
            variant="ghost"
            className="ml-auto text-danger-600"
            onClick={async () => {
              if (!confirmDelete) return setConfirmDelete(true);
              const err = await send(`/api/roles/${roleId}`, "DELETE");
              if (err) setMsg(err);
              else router.push("/staff/roles");
            }}
          >
            {confirmDelete ? "Tap again to delete" : "Delete role"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function NewRole({ roles }: { roles: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="lg" />}>New role</SheetTrigger>
      <SheetContent side="auto">
        <SheetTitle className="text-heading">New role</SheetTitle>
        <form
          className="mt-4 flex max-w-md flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const r = await request<{ id: string }>("/api/roles", "POST", { name: f.get("name"), ...(f.get("copyFrom") ? { copyFrom: f.get("copyFrom") } : {}) });
            if (r.error !== undefined) return setError(r.error);
            router.push(`/staff/roles/${r.data.id}`);
          }}
        >
          <Field label="Name" id="new-role">
            <Input id="new-role" name="name" required placeholder="e.g. Accountant" autoFocus />
          </Field>
          <Field label="Start from" id="copy-from">
            <select id="copy-from" name="copyFrom" className="h-12 rounded-lg border border-input bg-background px-3 text-body">
              <option value="">Nothing ticked</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          {error ? (
            <p role="alert" className="text-label text-danger-600">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg">
            Create role
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
