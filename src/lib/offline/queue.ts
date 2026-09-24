import { markKey, type QueuedMark, type QueueStore } from "./sync";

// IndexedDB adapter for the attendance queue (browser only).
const DB = "bravitar-offline";
const STORE = "marks";
export const QUEUE_EVENT = "bravitar:queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req ? req.result : undefined);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

const changed = () => window.dispatchEvent(new Event(QUEUE_EVENT));

// Look a row up and rewrite or drop it inside one transaction.
const each = (keys: string[], fn: (s: IDBObjectStore, row: QueuedMark | undefined, key: string) => void) => (s: IDBObjectStore) => {
  for (const key of keys) {
    const g = s.get(key) as IDBRequest<QueuedMark | undefined>;
    g.onsuccess = () => fn(s, g.result, key);
  }
};

export const queue: QueueStore & {
  add(sessionId: string, marks: { studentId: string; status: QueuedMark["status"]; note: string | null }[]): Promise<void>;
  forSession(sessionId: string): Promise<QueuedMark[]>;
  discardFailed(): Promise<void>;
  clear(): Promise<void>;
} = {
  all: async () => ((await run("readonly", (s) => s.getAll())) ?? []) as QueuedMark[],
  async add(sessionId, marks) {
    const queuedAt = Date.now();
    await run("readwrite", (s) => {
      for (const m of marks) s.put({ key: markKey(sessionId, m.studentId), sessionId, ...m, queuedAt } satisfies QueuedMark);
    });
    changed();
  },
  async remove(sent) {
    const at = new Map(sent.map((x) => [x.key, x.queuedAt]));
    await run("readwrite", each([...at.keys()], (s, row, key) => row?.queuedAt === at.get(key) && s.delete(key)));
    changed();
  },
  async fail(keys, error) {
    await run("readwrite", each(keys, (s, row) => row && s.put({ ...row, error })));
    changed();
  },
  forSession: async (sessionId) => (await queue.all()).filter((m) => m.sessionId === sessionId),
  async discardFailed() {
    const failed = (await queue.all()).filter((m) => m.error).map((m) => m.key);
    await run("readwrite", (s) => failed.forEach((k) => s.delete(k)));
    changed();
  },
  async clear() {
    await run("readwrite", (s) => s.clear());
    changed();
  },
};
