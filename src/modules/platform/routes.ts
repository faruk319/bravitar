import { sessionCookieHeader } from "@/lib/auth/cookie";
import { json, jsonError } from "@/lib/auth/route";
import { NotFoundError } from "@/lib/errors";
import { metaOf, slugFromHost } from "@/modules/auth/routes";
import { platformSignIn } from "./auth";

// POST /api/platform/login, on the main site only.
export async function platformLoginHandler(req: Request): Promise<Response> {
  try {
    if (slugFromHost(req.headers.get("host"))) throw new NotFoundError("Page");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { token } = await platformSignIn({ email: String(body.email ?? ""), password: String(body.password ?? ""), code: String(body.code ?? ""), ...metaOf(req) });
    return json({ ok: true }, { headers: { "set-cookie": sessionCookieHeader(token) } });
  } catch (err) {
    return jsonError(err);
  }
}
