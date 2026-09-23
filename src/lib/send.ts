// JSON request from a client component: undefined on success, else a message to show.
export async function send(path: string, method: string, body?: unknown): Promise<string | undefined> {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (res.ok) return undefined;
  const b = (await res.json().catch(() => ({}))) as { error?: string; issues?: { message: string }[] };
  return b.issues?.[0]?.message ?? b.error ?? "Could not save";
}
