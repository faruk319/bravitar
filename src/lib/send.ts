// JSON request from a client component: the parsed body, or a message to show.
export async function request<T>(path: string, method: string, body?: unknown): Promise<{ data: T; error?: undefined } | { data?: undefined; error: string }> {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const b = (await res.json().catch(() => ({}))) as T & { error?: string; issues?: { message: string }[] };
  if (res.ok) return { data: b };
  return { error: b.issues?.[0]?.message ?? b.error ?? "Could not save" };
}

// Same, when only success or failure matters: undefined, or the message.
export async function send(path: string, method: string, body?: unknown): Promise<string | undefined> {
  return (await request(path, method, body)).error;
}
