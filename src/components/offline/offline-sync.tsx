"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { QUEUE_EVENT, queue } from "@/lib/offline/queue";
import { type Conflict, syncQueue } from "@/lib/offline/sync";
import { request } from "@/lib/send";

type State = { pending: number; failed: number; failedReason: string; offline: boolean; notices: string[] };

let state: State = { pending: 0, failed: 0, failedReason: "", offline: false, notices: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useSyncState = () => useSyncExternalStore(subscribe, () => state, () => state);

const NOTICES = "bravitar.notices";
function saveNotices(notices: string[]) {
  set({ notices });
  try {
    localStorage.setItem(NOTICES, JSON.stringify(notices));
  } catch {}
}

// "Replaced Ravi Patil's marks for Zoya, Aarav": last write wins, but it is said (docs/01).
export function describeConflicts(conflicts: Conflict[]): string[] {
  const byPerson = new Map<string, string[]>();
  for (const c of conflicts) byPerson.set(c.by, [...(byPerson.get(c.by) ?? []), c.name]);
  return [...byPerson].map(([by, names]) => `Replaced ${by}'s ${names.length === 1 ? "mark" : "marks"} for ${names.join(", ")}`);
}

async function refreshCounts() {
  const rows = await queue.all().catch(() => []);
  const failed = rows.filter((r) => r.error);
  set({ pending: rows.length - failed.length, failed: failed.length, failedReason: failed[0]?.error ?? "" });
}

// A save that never reached the server.
export const markOffline = () => set({ offline: true });

// Sends what's queued; resolves with what went out and what still waits.
export async function syncNow(): Promise<{ sent: number; waiting: number }> {
  const r = await syncQueue(queue, (id, body) => request(`/api/sessions/${id}/attendance`, "PUT", body));
  if (r.conflicts.length) saveNotices([...state.notices, ...describeConflicts(r.conflicts)]);
  set({ offline: r.offline || !navigator.onLine });
  await refreshCounts();
  return { sent: r.sent, waiting: state.pending };
}

// In each shell, under the header: registers the service worker, keeps the queue
// moving, and says plainly when marks are waiting (docs/07 §3).
export function OfflineBanner() {
  const s = useSyncState();
  const router = useRouter();
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    try {
      set({ notices: JSON.parse(localStorage.getItem(NOTICES) ?? "[]") as string[] });
    } catch {}
    // Pages rendered before the sync show old counts: refresh once marks land.
    const sync = () => void syncNow().then((r) => r.sent && router.refresh(), () => {});
    const offline = () => set({ offline: true });
    const visible = () => document.visibilityState === "visible" && sync();
    const counts = () => void refreshCounts();
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", offline);
    window.addEventListener(QUEUE_EVENT, counts);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(() => state.pending && sync(), 30_000);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", offline);
      window.removeEventListener(QUEUE_EVENT, counts);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(timer);
    };
  }, [router]);

  if (!s.offline && !s.failed && !s.notices.length) return null;
  return (
    <div role="status" className="flex flex-col gap-1 border-b border-neutral-100 bg-background px-4 py-2 text-label md:px-6">
      {s.offline ? <p className="text-warning-600">Offline — {s.pending ? `${s.pending} ${s.pending === 1 ? "mark" : "marks"} will sync` : "attendance still works"}</p> : null}
      {s.failed ? (
        <p className="text-danger-600">
          {s.failed} {s.failed === 1 ? "mark" : "marks"} couldn&apos;t sync: {s.failedReason}{" "}
          <button type="button" className="underline" onClick={() => void queue.discardFailed()}>
            Discard
          </button>
        </p>
      ) : null}
      {s.notices.map((n, i) => (
        <p key={n} className="text-neutral-700">
          ⚠ {n}{" "}
          <button type="button" className="text-accent-600 underline" onClick={() => saveNotices(s.notices.filter((_, j) => j !== i))}>
            OK
          </button>
        </p>
      ))}
    </div>
  );
}

// "3 unsynced" in the header while anything waits.
export function SyncBadge() {
  const s = useSyncState();
  if (!s.pending && !s.failed) return null;
  return (
    <Link href="/today" className="rounded-full bg-warning-600/10 px-2.5 py-1 text-label text-warning-600">
      {s.failed ? `${s.failed} couldn't sync` : `${s.pending} unsynced`}
    </Link>
  );
}

// Today asks the service worker to keep today's rosters ready for no signal.
export function CacheForOffline({ urls }: { urls: string[] }) {
  const key = urls.join(",");
  useEffect(() => {
    navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "cache-pages", urls: key.split(",") })).catch(() => {});
  }, [key]);
  return null;
}
