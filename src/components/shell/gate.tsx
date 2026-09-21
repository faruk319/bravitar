import { ShieldOff } from "lucide-react";
import type { ReactNode } from "react";
import { can } from "@/lib/auth/can";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import { requireStaffPage } from "@/lib/auth/server";

// Server-side page gate: the same can() the routes use. Hidden nav is
// cosmetic; this is the check a typed-in URL meets.
export async function Gate({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const s = await requireStaffPage();
  const ctx = { tenantId: s.tenant.id, staffId: s.actor.id, isOwner: s.isOwner, modules: s.modules, permissions: s.permissions };
  const owningModule = PERMISSIONS[permission].module;
  if (!can(ctx, owningModule, permission)) {
    const moduleOff = !ctx.modules[owningModule];
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <ShieldOff className="size-10 text-neutral-300" aria-hidden />
        <h2 className="text-heading">{moduleOff ? "Not available" : "Not allowed"}</h2>
        <p className="text-body text-muted-foreground">{moduleOff ? "This is not part of your academy's plan." : "Ask your academy owner for access."}</p>
      </div>
    );
  }
  return <>{children}</>;
}
