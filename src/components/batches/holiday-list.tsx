"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useBranch } from "@/components/shell/tenant-provider";
import { Field } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { send } from "@/lib/send";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";

type H = { id: string; date: string; name: string; branchId: string | null };

export function HolidayList({ holidays, canManage, allBranches, today }: { holidays: H[]; canManage: boolean; allBranches: boolean; today: string }) {
  const router = useRouter();
  const { branches } = useBranch();
  const [error, setError] = useState<string>();
  const branchName = (id: string | null) => (id ? (branches.find((b) => b.id === id)?.name ?? "Other branch") : "All branches");

  async function call(path: string, method: string, body?: unknown) {
    const err = await send(path, method, body);
    setError(err);
    if (!err) router.refresh();
    return !err;
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const branchId = (f.get("branchId") as string | null) || null;
    if (await call("/api/holidays", "POST", { date: f.get("date"), name: f.get("name"), branchId })) form.reset();
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {canManage ? (
        <Card>
        <form onSubmit={add} className="grid gap-3 md:grid-cols-2">
          <Field label="Date" id="date">
            <Input id="date" name="date" type="date" required min={today} />
          </Field>
          <Field label="Name" id="hname">
            <Input id="hname" name="name" required placeholder="e.g. Diwali" />
          </Field>
          {branches.length > 1 ? (
            <Field label="Branch" id="branchId">
              <select id="branchId" name="branchId" defaultValue={allBranches ? "" : (branches[0]?.id ?? "")} className="h-12 rounded-lg border border-border bg-background px-3 text-body">
                {allBranches ? <option value="">All branches</option> : null}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className="flex items-end">
            <Button type="submit" className="w-full">Add holiday</Button>
          </div>
        </form>
        </Card>
      ) : null}
      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      {holidays.length ? (
        <Card className="overflow-hidden p-0 md:p-0">
        <ul className="divide-y divide-neutral-100">
          {holidays.map((h) => (
            <li key={h.id} className="flex min-h-14 items-center gap-3 px-4">
              <span className="w-28 shrink-0 text-body tabular-nums">{formatDate(h.date)}</span>
              <span className="flex-1 text-body">
                {h.name}
                {branches.length > 1 ? <span className="ml-2 text-caption text-muted-foreground">{branchName(h.branchId)}</span> : null}
              </span>
              {canManage ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${h.name}`} onClick={() => void call(`/api/holidays/${h.id}`, "DELETE")}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        </Card>
      ) : (
        <p className="text-body text-muted-foreground">No upcoming holidays.</p>
      )}
    </div>
  );
}
