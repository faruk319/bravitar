"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { withQuery } from "@/lib/url-query";
import { cn } from "@/lib/utils";

export type Option = { id: string; name: string };

const select = "h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base";
// One row of controls from xl, as many columns as there are controls (up to seven), so none is squeezed.
const XL_COLUMNS: Record<number, string> = { 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6", 7: "xl:grid-cols-7" };

// A date typed in the browser's field passes through years like 0002 on its way to 2026: send only a whole date, or none.
const isWhole = (v: string) => v === "" || v >= "1000-01-01";

// Keeps what is typed until it is a whole date, so a slow reload of the list cannot overwrite the keystrokes; a new date in the URL replaces it.
function DateField({ name, label, url, send }: { name: string; label: string; url: string; send: (v: string) => void }) {
  const [typed, setTyped] = useState(url);
  const [shown, setShown] = useState(url);
  if (shown !== url) {
    setShown(url);
    setTyped(url);
  }
  return (
    <label className="flex min-w-0 flex-col gap-1 text-caption text-muted-foreground">
      {label}
      <Input
        type="date"
        name={name}
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          if (isWhole(e.target.value)) send(e.target.value);
        }}
        aria-label={label}
      />
    </label>
  );
}

// The address after the bar changes some params: an empty one is dropped, and the list goes back to page 1.
export function nextHref(path: string, current: string, next: Record<string, string>): string {
  const p = new URLSearchParams(current);
  for (const [k, v] of Object.entries(next)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  p.delete("page");
  return withQuery(path, p);
}

type Props = {
  path: string;
  search: { placeholder: string };
  selects: { name: string; label: string; all: string; options: Option[] }[];
  dates: { name: string; label: string }[];
  sorts?: { value: string; label: string }[]; // the first is the default and stays out of the URL
};

// A list's search, filters and sort. Every one lives in the URL: a filtered list is linkable and survives a refresh.
export function FilterBar({ path, search, selects, dates, sorts }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  // What is typed in the search box until it is sent; a new q in the URL (a link, Clear filters) replaces it.
  const [typed, setTyped] = useState(get("q"));
  const [shown, setShown] = useState(get("q"));
  if (shown !== get("q")) {
    setShown(get("q"));
    setTyped(get("q"));
  }
  const push = (next: Record<string, string>) => router.replace(nextHref(path, params.toString(), next));
  const pick = (name: string, label: string, all: string, opts: Option[]) => (
    <select key={name} aria-label={label} value={get(name)} onChange={(e) => push({ [name]: e.target.value })} className={select}>
      <option value="">{all}</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
  // Clear drops the bar's own filters and keeps the rest of the URL (a status tab, the sort).
  const own = ["q", ...selects.map((s) => s.name), ...dates.map((d) => d.name)];
  const rest = new URLSearchParams(params.toString());
  for (const k of [...own, "page"]) rest.delete(k);
  const clear = withQuery(path, rest);
  const searchBox = (
    <div className={cn("relative min-w-0", sorts && "flex-1")}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input name="q" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={search.placeholder} aria-label="Search" inputMode="search" className="pl-10" />
    </div>
  );
  const first = sorts?.[0]?.value ?? "";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        push({ q: typed });
      }}
    >
      {sorts ? (
        <div className="flex flex-col gap-3 md:flex-row">
          {searchBox}
          <select aria-label="Sort" value={get("sort") || first} onChange={(e) => push({ sort: e.target.value === first ? "" : e.target.value })} className={cn(select, "md:w-52 md:flex-none")}>
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        searchBox
      )}
      <div className={cn("grid grid-cols-2 gap-2 md:grid-cols-4", XL_COLUMNS[Math.min(7, Math.max(4, selects.length + dates.length))])}>
        {selects.map((s) => pick(s.name, s.label, s.all, s.options))}
        {dates.map((d) => (
          <DateField key={d.name} name={d.name} label={d.label} url={get(d.name)} send={(v) => push({ [d.name]: v })} />
        ))}
      </div>
      {own.some((k) => get(k)) ? (
        <Link href={clear} className="inline-flex min-h-11 items-center gap-1.5 self-start text-label text-primary">
          <X className="size-4" aria-hidden /> Clear filters
        </Link>
      ) : null}
    </form>
  );
}
