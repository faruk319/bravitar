"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

// Plain GET-style filters: the list is server-rendered from the URL.
export function StudentSearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const push = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    router.replace(`/students?${p.toString()}`);
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        push({ q: (new FormData(e.currentTarget).get("q") as string) ?? "" });
      }}
    >
      <div className="relative min-w-0 flex-1 basis-56">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input name="q" defaultValue={q} placeholder="Name or phone" aria-label="Search" inputMode="search" className="pl-10" />
      </div>
      <select aria-label="Status" value={status} onChange={(e) => push({ status: e.target.value })} className="h-12 rounded-lg border border-input bg-background px-3 text-body">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="left">Left</option>
      </select>
    </form>
  );
}
