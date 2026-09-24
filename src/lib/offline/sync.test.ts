import { describe, expect, it } from "vitest";
import { markKey, type Put, type QueuedMark, type QueueStore, syncQueue, withQueued } from "./sync";

function memoryStore(rows: QueuedMark[]): QueueStore & { rows: QueuedMark[] } {
  const store = {
    rows: [...rows],
    all: async () => store.rows.map((r) => ({ ...r })),
    remove: async (sent: { key: string; queuedAt: number }[]) => {
      store.rows = store.rows.filter((r) => !sent.some((s) => s.key === r.key && s.queuedAt === r.queuedAt));
    },
    fail: async (keys: string[], error: string) => {
      store.rows = store.rows.map((r) => (keys.includes(r.key) ? { ...r, error } : r));
    },
  };
  return store;
}
const mark = (sessionId: string, studentId: string, status: QueuedMark["status"] = "present", queuedAt = 1): QueuedMark => ({ key: markKey(sessionId, studentId), sessionId, studentId, status, note: null, queuedAt });

describe("syncQueue", () => {
  it("sends one request per class and removes what was sent", async () => {
    const store = memoryStore([mark("s1", "a"), mark("s1", "b"), mark("s2", "c")]);
    const calls: [string, unknown][] = [];
    const put: Put = async (id, body) => (calls.push([id, body]), { data: { conflicts: [] } });
    expect(await syncQueue(store, put)).toEqual({ sent: 3, left: 0, failed: 0, offline: false, conflicts: [] });
    expect(calls.map(([id]) => id)).toEqual(["s1", "s2"]);
    expect(calls[0]?.[1]).toEqual({ marks: [{ studentId: "a", status: "present", note: null }, { studentId: "b", status: "present", note: null }], source: "offline_sync" });
    expect(store.rows).toEqual([]);
  });

  it("keeps everything when the network is down, and stops trying further classes", async () => {
    const store = memoryStore([mark("s1", "a"), mark("s2", "b")]);
    let calls = 0;
    const r = await syncQueue(store, async () => (calls++, { error: "No connection", offline: true }));
    expect([r.offline, r.left, calls, store.rows.length]).toEqual([true, 2, 1, 2]);
  });

  it("a refused class is flagged with the reason and not retried; conflicts come back", async () => {
    const store = memoryStore([mark("locked", "a"), mark("ok", "b", "absent")]);
    const put: Put = async (id) => (id === "locked" ? { error: "Marks lock 48 hours after the class." } : { data: { conflicts: [{ studentId: "b", name: "Zoya", from: "present", to: "absent", by: "Ravi" }] } });
    const r = await syncQueue(store, put);
    expect([r.sent, r.failed]).toEqual([1, 1]);
    expect(r.conflicts).toEqual([{ sessionId: "ok", studentId: "b", name: "Zoya", from: "present", to: "absent", by: "Ravi" }]);
    expect(store.rows).toEqual([{ ...mark("locked", "a"), error: "Marks lock 48 hours after the class." }]);
    let again = 0;
    await syncQueue(store, async () => (again++, { data: { conflicts: [] } }));
    expect(again).toBe(0);
  });

  it("two syncs at once share one run; a mark changed mid-sync is kept for the next", async () => {
    const store = memoryStore([mark("s1", "a", "present", 1)]);
    let calls = 0;
    const put: Put = async () => {
      calls++;
      store.rows = [mark("s1", "a", "absent", 2)]; // tapped again while the request was out
      return { data: { conflicts: [] } };
    };
    const [x, y] = await Promise.all([syncQueue(store, put), syncQueue(store, put)]);
    expect(x).toBe(y);
    expect(calls).toBe(1);
    expect(store.rows).toEqual([mark("s1", "a", "absent", 2)]);
  });
});

describe("withQueued", () => {
  it("queued marks for the class override what the page was rendered with", () => {
    const entries = [
      { studentId: "a", mark: null, note: null },
      { studentId: "b", mark: "present" as const, note: null },
    ];
    expect(withQueued(entries, [{ ...mark("s1", "b", "late"), note: "bus" }])).toEqual([
      { studentId: "a", mark: null, note: null },
      { studentId: "b", mark: "late", note: "bus" },
    ]);
  });
});
