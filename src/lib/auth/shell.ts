import type { PermissionKey } from "./permissions";

export type Shell = "coach" | "admin";

// docs/07 §1: the shell follows the role, not the screen. A person whose
// permissions all fit a coach's day gets the coach shell; anyone with more
// (or the owner) gets the admin shell.
export const COACH_KEYS: readonly PermissionKey[] = [
  "students:read",
  "batches:read",
  "sessions:read",
  "sessions:note",
  "attendance:read",
  "attendance:mark",
  "attendance:amend",
];

export function shellFor(session: { isOwner: boolean; permissions: string[] }): Shell {
  if (session.isOwner) return "admin";
  return session.permissions.every((p) => (COACH_KEYS as readonly string[]).includes(p)) ? "coach" : "admin";
}

export function homeFor(shell: Shell): string {
  return shell === "coach" ? "/today" : "/dashboard";
}
