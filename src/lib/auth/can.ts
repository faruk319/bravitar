import { AppError } from "@/lib/errors";
import { CORE_MODULES, isPermissionKey, PERMISSIONS, type PermissionKey } from "./permissions";

// What a request knows about its actor. Built by loadAccessContext() and,
// from the auth slice on, cached on the session row (docs/01 session payload).
export type AccessContext = {
  tenantId: string;
  staffId: string;
  isOwner: boolean;
  modules: Record<string, boolean>;
  permissions: string[];
};

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403);
  }
}

// docs/01 "Authorization — two gates". A switched-off module is off for
// everyone, the owner included: the flag belongs to the tenant, not the person.
export function can(ctx: AccessContext, module: string, permission: string): boolean {
  if (!ctx.modules[module]) return false; // 1. tenant feature flag
  if (ctx.isOwner) return true; // 2. owner bypass
  return ctx.permissions.includes(permission); // 3. role permissions (union)
}

// Service-layer gate: the module comes from the catalog, not the caller.
export function assertCan(ctx: AccessContext, permission: PermissionKey): void {
  const owningModule = PERMISSIONS[permission].module;
  if (!can(ctx, owningModule, permission)) {
    throw new ForbiddenError(`Not allowed: ${permission}`);
  }
}

// tenants.enabled_modules plus the modules that are never switched off.
export function moduleFlags(enabledModules: Record<string, boolean>): Record<string, boolean> {
  return { ...enabledModules, ...Object.fromEntries(CORE_MODULES.map((m) => [m, true])) };
}

export function assertKnownPermission(key: string): PermissionKey {
  if (!isPermissionKey(key)) throw new Error(`Unknown permission: ${key}`);
  return key;
}
