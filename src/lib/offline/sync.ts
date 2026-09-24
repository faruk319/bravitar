import type { RequestResult } from "@/lib/send";
import type { Mark } from "@/modules/attendance/schema";

// One row per (class, student): the latest mark made on this phone.
export type QueuedMark = { key: string; sessionId: string; studentId: string; status: Mark; note: string | null; queuedAt: number; error?: string };
export type QueueStore = {
  all(): Promise<QueuedMark[]>;
  // Removes only rows still at that queuedAt, so a newer mark made mid-sync survives.
  remove(sent: { key: string; queuedAt: number }[]): Promise<void>;
  fail(keys: string[], error: string): Promise<void>;
};
export type Conflict = { studentId: string; name: string; from: Mark; to: Mark; by: string };
export type Put = (sessionId: string, body: unknown) => Promise<RequestResult<{ conflicts: Conflict[] }>>;
export type SyncResult = { sent: number; left: number; failed: number; offline: boolean; conflicts: (Conflict & { sessionId: string })[] };

export const markKey = (sessionId: string, studentId: string) => `${sessionId}|${studentId}`;

let running: Promise<SyncResult> | undefined;

// One PUT per class with source offline_sync; the server upsert makes replays harmless.
export function syncQueue(store: QueueStore, put: Put): Promise<SyncResult> {
  running ??= run(store, put).finally(() => {
    running = undefined;
  });
  return running;
}

async function run(store: QueueStore, put: Put): Promise<SyncResult> {
  const out: SyncResult = { sent: 0, left: 0, failed: 0, offline: false, conflicts: [] };
  const bySession = new Map<string, QueuedMark[]>();
  for (const m of await store.all()) if (!m.error) bySession.set(m.sessionId, [...(bySession.get(m.sessionId) ?? []), m]);
  for (const [sessionId, marks] of bySession) {
    if (out.offline) {
      out.left += marks.length;
      continue;
    }
    const r = await put(sessionId, { marks: marks.map(({ studentId, status, note }) => ({ studentId, status, note })), source: "offline_sync" });
    if (r.error !== undefined && r.offline) {
      out.offline = true;
      out.left += marks.length;
    } else if (r.error !== undefined) {
      await store.fail(marks.map((m) => m.key), r.error);
      out.failed += marks.length;
    } else {
      await store.remove(marks.map(({ key, queuedAt }) => ({ key, queuedAt })));
      out.sent += marks.length;
      out.conflicts.push(...r.data.conflicts.map((c) => ({ ...c, sessionId })));
    }
  }
  return out;
}

// Queued marks for one class win over what the page was rendered with.
export function withQueued<T extends { studentId: string; mark: Mark | null; note: string | null }>(entries: T[], queued: QueuedMark[]): T[] {
  const byStudent = new Map(queued.map((q) => [q.studentId, q]));
  return entries.map((e) => {
    const q = byStudent.get(e.studentId);
    return q ? { ...e, mark: q.status, note: q.note } : e;
  });
}
