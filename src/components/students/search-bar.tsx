"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import type { StudentList } from "@/modules/students/service";

const FILTERS = ["status", "program", "batch", "coach", "fee", "joinedFrom", "joinedTo", "q"];
const select = "h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base";

type Option = { id: string; name: string };

// Every filter lives in the URL: a filtered list is linkable and survives a refresh.
export function StudentSearchBar({ options, fee }: { options: StudentList["options"]; fee: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const push = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    router.replace(`/students?${p.toString()}`);
  };
  const pick = (name: string, label: string, all: string, opts: Option[]) => (
    <select aria-label={label} value={get(name)} onChange={(e) => push({ [name]: e.target.value })} className={select}>
      <option value="">{all}</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
  const day = (name: string, label: string) => (
    <label className="flex min-w-0 flex-col gap-1 text-caption text-muted-foreground">
      {label}
      <Input type="date" name={name} value={get(name)} onChange={(e) => push({ [name]: e.target.value })} aria-label={label} />
    </label>
  );
  const filtered = FILTERS.some((k) => get(k));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        push({ q: (new FormData(e.currentTarget).get("q") as string) ?? "" });
      }}
    >
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input name="q" defaultValue={get("q")} placeholder="Name or phone" aria-label="Search" inputMode="search" className="pl-10" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {options.programs ? pick("program", "Program", "All programs", options.programs) : null}
        {options.batches ? pick("batch", "Batch", "All batches", options.batches) : null}
        {options.coaches ? pick("coach", "Coach", "All coaches", options.coaches) : null}
        <select aria-label="Status" value={get("status")} onChange={(e) => push({ status: e.target.value })} className={select}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="left">Left</option>
        </select>
        {fee ? (
          <select aria-label="Fee status" value={get("fee")} onChange={(e) => push({ fee: e.target.value })} className={select}>
            <option value="">All fees</option>
            <option value="paid">Paid</option>
            <option value="due">Due</option>
            <option value="overdue">Overdue</option>
          </select>
        ) : null}
        {day("joinedFrom", "Joined from")}
        {day("joinedTo", "Joined to")}
      </div>
      {filtered ? (
        <Link href="/students" className="inline-flex min-h-11 items-center gap-1.5 self-start text-label text-primary">
          <X className="size-4" aria-hidden /> Clear filters
        </Link>
      ) : null}
    </form>
  );
}
