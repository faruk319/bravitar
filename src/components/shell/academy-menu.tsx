"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type AcademyChoice = { slug: string; name: string };

// "Switch academy": a parent's other academies on the portal (agreed
// 2026-09-25), a staff member's linked ones (agreed 2026-10-02). Each posts
// to action, which answers with the pass to that academy.
export function AcademyMenu({ academies, action }: { academies: AcademyChoice[]; action: string }) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  // A <details> ignores Escape and outside clicks; close on both, focus back on the summary.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      root.current?.removeAttribute("open");
      root.current?.querySelector("summary")?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  if (!academies.length) return null;
  return (
    <details ref={root} onToggle={(e) => setOpen(e.currentTarget.open)} className="relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-label text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-ring">
        Switch<span className="hidden sm:inline"> academy</span> <ChevronDown className="size-4" aria-hidden />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-neutral-100 bg-card p-1 shadow-card">
        {academies.map((a) => (
          <form key={a.slug} method="post" action={action}>
            <input type="hidden" name="slug" value={a.slug} />
            <button type="submit" className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-body outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-ring">
              {a.name}
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}
