"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatPhone } from "@/lib/phone";
import { useSession } from "./tenant-provider";

type Hit = { id: string; name: string; code: string; guardian: string };
type Row = { student: { id: string; fullName: string; code: string }; guardianName: string | null; guardianPhone: string | null };

// docs/07 §4: ⌘K finds a student by name, parent or phone.
export function CommandSearch() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const allowed = session.isOwner || session.permissions.includes("students:read");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function search(q: string) {
    clearTimeout(timer.current);
    if (q.trim().length < 2) return setHits([]);
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/students?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) return;
      const { students } = (await res.json()) as { students: Row[] };
      setHits(students.slice(0, 8).map((r) => ({ id: r.student.id, name: r.student.fullName, code: r.student.code, guardian: r.guardianName ? `${r.guardianName} · ${formatPhone(r.guardianPhone ?? "")}` : "" })));
    }, 200);
  }

  if (!allowed) return null;
  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) setHits([]); }}>
      <SheetTrigger
        render={<button type="button" aria-label="Search" className="flex size-10 shrink-0 items-center justify-center gap-2 rounded-full text-muted-foreground hover:bg-neutral-50 md:h-10 md:w-full md:max-w-sm md:justify-start md:border md:border-neutral-100 md:bg-canvas md:px-4" />}
      >
        <Search className="size-5 md:size-4" aria-hidden />
        <span className="hidden flex-1 text-left text-label md:inline">Search students, parents, phone</span>
        <kbd className="hidden rounded border border-neutral-300 px-1.5 text-caption md:inline">⌘K</kbd>
      </SheetTrigger>
      <SheetContent side="top" className="mx-auto max-w-xl rounded-b-2xl p-4">
        <SheetTitle className="sr-only">Search</SheetTitle>
        <Input autoFocus type="search" placeholder="Name, parent or phone" autoComplete="off" onChange={(e) => search(e.target.value)} className="pr-12" />
        {hits.length ? (
          <ul className="flex flex-col">
            {hits.map((h) => (
              <li key={h.id}>
                <Link href={`/students/${h.id}`} onClick={() => setOpen(false)} className="flex min-h-14 items-center gap-3 rounded-lg px-2 hover:bg-neutral-50">
                  <Avatar name={h.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-neutral-900">
                      {h.name} <span className="text-caption text-muted-foreground">{h.code}</span>
                    </span>
                    {h.guardian ? <span className="block truncate text-caption text-muted-foreground">{h.guardian}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
