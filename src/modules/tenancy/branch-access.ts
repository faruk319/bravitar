import type { Tx } from "@/lib/db/client";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { getBranch, getDefaultBranch } from "./repo";

// The branch a new record goes to. `allowed` is the staff member's branch
// list (empty = all). Another branch is "not found", never "forbidden".
export async function pickBranch(tx: Tx, allowed: string[], wanted: string | undefined): Promise<string> {
  if (wanted) {
    if (allowed.length && !allowed.includes(wanted)) throw new NotFoundError("Branch");
    if (!(await getBranch(tx, wanted))) throw new NotFoundError("Branch");
    return wanted;
  }
  if (allowed.length === 1) return allowed[0] ?? "";
  const def = await getDefaultBranch(tx);
  if (!def || (allowed.length && !allowed.includes(def.id))) throw new BadRequestError("Pick a branch");
  return def.id;
}

export function canUseBranch(allowed: string[], branchId: string): boolean {
  return !allowed.length || allowed.includes(branchId);
}
