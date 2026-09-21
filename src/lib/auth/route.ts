import { assertCan } from "@/lib/auth/can";
import type { PermissionKey } from "@/lib/auth/permissions";
import { getStaffSession, type StaffSession } from "@/lib/auth/session";
import type { Tx } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { ZodError } from "zod";
import { AppError, UnauthorizedError } from "@/lib/errors";

export type StaffRequest = { req: Request; session: StaffSession; tx: Tx };

// Every staff route declares its permission (or `null`, deliberately, for
// routes like /me and /logout). The session is resolved from the cookie, the
// tenant context is opened, and errors become JSON responses.
export function withStaffRequest(permission: PermissionKey | null, handler: (r: StaffRequest) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      const session = await getStaffSession(req);
      if (!session) throw new UnauthorizedError();
      if (permission) {
        assertCan(
          { tenantId: session.tenant.id, staffId: session.actor.id, isOwner: session.isOwner, modules: session.modules, permissions: session.permissions },
          permission,
        );
      }
      return await withTenant(session.tenant.id, (tx) => handler({ req, session, tx }));
    } catch (err) {
      return jsonError(err);
    }
  };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });
}

export function jsonError(err: unknown): Response {
  if (err instanceof AppError) return json({ error: err.message }, { status: err.status });
  if (err instanceof ZodError) {
    return json({ error: "Invalid input", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  console.error(err);
  return json({ error: "Something went wrong" }, { status: 500 });
}
