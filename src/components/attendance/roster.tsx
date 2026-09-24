"use client";

import { useEffect, useRef, useState } from "react";
import { MarkBadge } from "@/components/attendance/mark-badge";
import { describeConflicts, markOffline, syncNow, useSyncState } from "@/components/offline/offline-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { QUEUE_EVENT, queue } from "@/lib/offline/queue";
import { type Conflict, withQueued } from "@/lib/offline/sync";
import { request } from "@/lib/send";
import { cn } from "@/lib/utils";

type Mark = "present" | "absent" | "late" | "excused";
type Entry = { studentId: string; name: string; code: string; paused: boolean; mark: Mark | null; note: string | null };
type Marks = Record<string, { mark: Mark | null; note: string | null }>;

const NEXT: Record<Mark | "none", Mark> = { none: "present", present: "absent", absent: "late", late: "present", excused: "present" };

// docs/07 §7.2: mark all present, tap the exceptions (Present → Absent → Late),
// long press for a note, save from the thumb zone. Nothing is sent until Save.
export function Roster({ sessionId, entries, canMark, stickyBottom }: { sessionId: string; entries: Entry[]; canMark: boolean; stickyBottom: string }) {
  const initial: Marks = Object.fromEntries(entries.map((e) => [e.studentId, { mark: e.mark, note: e.note }]));
  const [marks, setMarks] = useState<Marks>(initial);
  const [saved, setSaved] = useState<Marks>(initial);
  const [undo, setUndo] = useState<Marks>();
  const [phase, setPhase] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState<string>();
  const [noteFor, setNoteFor] = useState<Entry>();
  const [waiting, setWaiting] = useState(0); // this class's marks still on the phone
  const [replaced, setReplaced] = useState<string[]>([]);
  const { offline } = useSyncState();

  // Marks saved on this phone while offline win over the page as it was cached.
  useEffect(() => {
    let first = true;
    const load = () =>
      void queue.forSession(sessionId).then((q) => {
        setWaiting(q.filter((m) => !m.error).length);
        if (!first || !q.length) return;
        first = false;
        const merged = Object.fromEntries(withQueued(entries, q).map((e) => [e.studentId, { mark: e.mark, note: e.note }]));
        setMarks((m) => ({ ...m, ...merged }));
        setSaved((m) => ({ ...m, ...merged }));
      });
    load();
    window.addEventListener(QUEUE_EVENT, load);
    return () => window.removeEventListener(QUEUE_EVENT, load);
  }, [sessionId, entries]);
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; long: boolean }>({ long: false });

  const markable = entries.filter((e) => !e.paused || saved[e.studentId]?.mark);
  const dirty = markable.filter((e) => marks[e.studentId]?.mark !== saved[e.studentId]?.mark || marks[e.studentId]?.note !== saved[e.studentId]?.note);
  const here = markable.filter((e) => marks[e.studentId]?.mark === "present" || marks[e.studentId]?.mark === "late").length;
  const unmarked = markable.filter((e) => !marks[e.studentId]?.mark);
  const set = (id: string, patch: Partial<Marks[string]>) => setMarks((m) => ({ ...m, [id]: { mark: null, note: null, ...m[id], ...patch } }));

  function tap(e: Entry) {
    if (press.current.long) return void (press.current.long = false);
    set(e.studentId, { mark: NEXT[marks[e.studentId]?.mark ?? "none"] });
    setUndo(undefined);
  }
  function hold(e: Entry) {
    press.current.timer = setTimeout(() => {
      press.current.long = true;
      if (!marks[e.studentId]?.mark) set(e.studentId, { mark: "present" });
      setNoteFor(e);
    }, 500);
  }
  const release = () => clearTimeout(press.current.timer);
  function allPresent() {
    setUndo(marks);
    setMarks((m) => ({ ...m, ...Object.fromEntries(unmarked.map((e) => [e.studentId, { note: null, ...m[e.studentId], mark: "present" as const }])) }));
  }
  async function save() {
    setPhase("saving");
    const payload = dirty.map((e) => ({ studentId: e.studentId, status: marks[e.studentId]?.mark ?? "present", note: marks[e.studentId]?.note ?? null }));
    await syncNow().catch(() => {}); // older marks from this phone go first
    const r = await request<{ conflicts: Conflict[] }>(`/api/sessions/${sessionId}/attendance`, "PUT", { marks: payload });
    if (r.error !== undefined && r.offline) {
      await queue.add(sessionId, payload);
      markOffline();
    } else if (r.error !== undefined) {
      setError(r.error);
      return setPhase("error");
    } else {
      setReplaced(describeConflicts(r.data.conflicts));
    }
    setSaved(marks);
    setUndo(undefined);
    setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
    setPhase("idle");
  }

  return (
    <>
      {canMark ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {undo ? (
            <Button variant="outline" size="lg" onClick={() => {
                setMarks(undo);
                setUndo(undefined);
              }}>
              Undo
            </Button>
          ) : (
            <Button variant="outline" size="lg" onClick={allPresent} disabled={!unmarked.length}>
              Mark all present
            </Button>
          )}
          <span className="text-number tabular-nums">
            {here}/{markable.filter((e) => !e.paused).length}
          </span>
        </div>
      ) : null}

      <ul className="overflow-hidden rounded-2xl border border-neutral-100 bg-card shadow-card">
        {entries.map((e) => {
          const m = marks[e.studentId];
          const disabled = !canMark || (e.paused && !saved[e.studentId]?.mark);
          return (
            <li key={e.studentId} className="border-b border-neutral-100 last:border-b-0">
              <button
                type="button"
                disabled={disabled}
                onClick={() => tap(e)}
                onPointerDown={() => hold(e)}
                onPointerUp={release}
                onPointerLeave={release}
                onPointerCancel={release}
                onContextMenu={(ev) => ev.preventDefault()}
                className={cn("flex min-h-14 w-full items-center gap-3 px-4 text-left select-none active:bg-neutral-50", e.paused && "opacity-60")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-neutral-900">{e.name}</span>
                  {m?.note ? <span className="block truncate text-caption text-muted-foreground">{m.note}</span> : null}
                </span>
                {e.paused && !m?.mark ? <span className="text-label text-muted-foreground">Paused</span> : <MarkBadge mark={m?.mark ?? null} className="min-w-24" />}
              </button>
            </li>
          );
        })}
      </ul>

      {replaced.map((line) => (
        <p key={line} className="mt-3 text-label text-warning-600">
          ⚠ {line}
        </p>
      ))}

      {canMark ? (
        <div className={cn("sticky z-10 -mx-4 mt-4 border-t border-neutral-100 bg-background px-4 py-3 md:mx-0 md:rounded-2xl md:border", stickyBottom)}>
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-label" aria-live="polite">
              {phase === "saving" ? (
                "Saving…"
              ) : phase === "error" ? (
                <span className="text-danger-600">Couldn&apos;t save · {error}</span>
              ) : dirty.length ? (
                `${dirty.length} unsaved`
              ) : waiting ? (
                <span className="text-warning-600">{offline ? `Offline — ${waiting} ${waiting === 1 ? "mark" : "marks"} will sync` : `✓ Saved on this phone · ${waiting} to sync`}</span>
              ) : savedAt ? (
                <span className="text-success-600">✓ Saved {savedAt}</span>
              ) : null}
            </span>
            <Button size="lg" onClick={save} disabled={!dirty.length || phase === "saving"}>
              {phase === "error" ? "Retry" : "Save attendance"}
            </Button>
          </div>
        </div>
      ) : null}

      <Sheet open={Boolean(noteFor)} onOpenChange={(o) => !o && setNoteFor(undefined)}>
        <SheetContent side="auto">
          <SheetTitle className="text-heading">Note for {noteFor?.name}</SheetTitle>
          <form
            className="mt-4 flex max-w-md flex-col gap-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (noteFor) set(noteFor.studentId, { note: (new FormData(ev.currentTarget).get("note") as string).trim() || null });
              setNoteFor(undefined);
            }}
          >
            <Input name="note" defaultValue={noteFor ? (marks[noteFor.studentId]?.note ?? "") : ""} placeholder="e.g. left early" maxLength={300} autoFocus />
            <Button type="submit" size="lg">
              Done
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
