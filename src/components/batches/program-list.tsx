"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useLabel } from "@/components/shell/tenant-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { send } from "@/lib/send";
import { Input } from "@/components/ui/input";

type P = { id: string; name: string; isActive: boolean };

export function ProgramList({ programs, canManage }: { programs: P[]; canManage: boolean }) {
  const router = useRouter();
  const label = useLabel("program");
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<string>();

  async function call(path: string, method: string, body: unknown) {
    const err = await send(path, method, body);
    setError(err);
    if (!err) router.refresh();
    return !err;
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = (new FormData(form).get("name") as string).trim();
    if (await call("/api/programs", "POST", { name })) form.reset();
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {canManage ? (
        <form onSubmit={add} className="flex gap-2">
          <Input name="name" placeholder={`New ${label.toLowerCase()}`} aria-label={`New ${label.toLowerCase()}`} required className="flex-1" />
          <Button type="submit">Add</Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      <Card className="overflow-hidden p-0 md:p-0">
      <ul className="divide-y divide-neutral-100">
        {programs.map((p) => (
          <li key={p.id} className="flex min-h-14 items-center gap-3 px-4">
            {editing === p.id ? (
              <form
                className="flex flex-1 gap-2 py-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await call(`/api/programs/${p.id}`, "PATCH", { name: new FormData(e.currentTarget).get("name") })) setEditing(undefined);
                }}
              >
                <Input name="name" defaultValue={p.name} autoFocus required className="flex-1" aria-label="Name" />
                <Button type="submit" size="sm">Save</Button>
              </form>
            ) : (
              <>
                <span className={p.isActive ? "flex-1 text-body" : "flex-1 text-body text-muted-foreground line-through"}>{p.name}</span>
                {canManage ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p.id)}>Rename</Button>
                    <Button variant="ghost" size="sm" onClick={() => void call(`/api/programs/${p.id}`, "PATCH", { isActive: !p.isActive })}>
                      {p.isActive ? "Hide" : "Show"}
                    </Button>
                  </>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      </Card>
    </div>
  );
}
