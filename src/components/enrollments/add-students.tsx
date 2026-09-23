"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { send } from "@/lib/send";

type Found = { id: string; name: string; code: string };

// Batch page path: find active students and add each with one tap.
export function AddStudents({ batchId, today, inBatch, full }: { batchId: string; today: string; inBatch: string[]; full: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today);
  const [found, setFound] = useState<Found[]>([]);
  const [result, setResult] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function search(q: string) {
    clearTimeout(timer.current);
    if (q.trim().length < 2) return setFound([]);
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/students?status=active&q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) return;
      const { students } = (await res.json()) as { students: { student: { id: string; fullName: string; code: string } }[] };
      setFound(students.slice(0, 20).map(({ student: s }) => ({ id: s.id, name: s.fullName, code: s.code })));
    }, 250);
  }

  async function add(studentId: string) {
    const err = await send("/api/enrollments", "POST", { studentId, batchId, startDate: from });
    setResult((r) => ({ ...r, [studentId]: err ?? "Added" }));
  }

  function onOpenChange(o: boolean) {
    setOpen(o);
    if (o) {
      setFound([]);
      setResult({});
    } else if (Object.values(result).includes("Added")) router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger render={<Button />}>Add students</SheetTrigger>
      <SheetContent side="auto">
        <SheetTitle className="text-heading">Add students</SheetTitle>
        <div className="mt-4 flex max-w-md flex-col gap-4">
          {full ? <p className="text-label text-warning-600">This batch is full.</p> : null}
          <Field label="Joining from" id="from">
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Find student" id="q">
            <Input id="q" type="search" placeholder="Name or phone" autoComplete="off" onChange={(e) => search(e.target.value)} />
          </Field>
          <ul className="divide-y divide-border">
            {found.map((s) => {
              const note = inBatch.includes(s.id) ? "In batch" : result[s.id];
              return (
                <li key={s.id} className="flex min-h-14 items-center justify-between gap-3">
                  <span className="text-body">
                    {s.name} <span className="text-caption text-muted-foreground tabular-nums">{s.code}</span>
                  </span>
                  {note ? (
                    <span className={note === "Added" || note === "In batch" ? "text-label text-muted-foreground" : "text-label text-danger-600"}>{note}</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => void add(s.id)}>
                      Add
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
