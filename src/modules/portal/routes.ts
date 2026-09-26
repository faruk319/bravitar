import { readSessionCookie } from "@/lib/auth/cookie";
import { pathSegment } from "@/lib/auth/route";
import { type GuardianSession, getGuardianSessionFromToken } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { switchAcademy } from "@/modules/auth/guardian";
import { payLink } from "./service";

const guardianOf = async (req: Request): Promise<GuardianSession | undefined> => {
  const token = readSessionCookie(req);
  return token ? getGuardianSessionFromToken(token) : undefined;
};
const go = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

// GET /portal/pay/<invoiceId>: on to the invoice's private page.
export async function payHandler(req: Request): Promise<Response> {
  const s = await guardianOf(req);
  if (!s) return go("/login");
  const url = await withTenant(s.tenant.id, (tx) => payLink(tx, { tenantId: s.tenant.id, guardianId: s.actor.id }, pathSegment(req, 2))).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  return url ? go(url) : new Response("Not found", { status: 404 });
}

// POST /portal/switch (a form): the pass to another academy with this number.
export async function switchHandler(req: Request): Promise<Response> {
  const s = await guardianOf(req);
  const slug = String((await req.formData().catch(() => undefined))?.get("slug") ?? "");
  const pass = s ? await switchAcademy(s.phone, slug) : undefined;
  return go(pass?.url ?? "/portal");
}
