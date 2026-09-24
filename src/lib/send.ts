export type RequestResult<T> = { data: T; error?: undefined; offline?: undefined } | { data?: undefined; error: string; offline?: boolean };

// JSON request from a client component: the parsed body, or a message to show.
// `offline` means the request never reached the server.
export async function request<T>(path: string, method: string, body?: unknown): Promise<RequestResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    return { error: "No connection", offline: true };
  }
  const b = (await res.json().catch(() => ({}))) as T & { error?: string; issues?: { message: string }[] };
  if (res.ok) return { data: b };
  return { error: b.issues?.[0]?.message ?? b.error ?? "Could not save" };
}

// Same, when only success or failure matters: undefined, or the message.
export async function send(path: string, method: string, body?: unknown): Promise<string | undefined> {
  return (await request(path, method, body)).error;
}
