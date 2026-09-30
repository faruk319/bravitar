import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/lib/db/with-tenant";
import { slugFromHost } from "@/modules/auth/routes";
import { listBranches } from "@/modules/tenancy/repo";
import { BRANCH_COOKIE } from "./branch-cookie";
import { SESSION_COOKIE } from "./cookie";
import { type GuardianSession, getGuardianSessionFromToken, getPlatformSessionFromToken, getStaffSessionFromToken, type PlatformSession, type StaffSession } from "./session";

// Server-component side of the session. Route handlers use getStaffSession(req).
export async function currentStaffSession(): Promise<StaffSession | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getStaffSessionFromToken(token) : undefined;
}

export async function currentGuardianSession(): Promise<GuardianSession | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getGuardianSessionFromToken(token) : undefined;
}

export async function requireGuardianPage(): Promise<GuardianSession> {
  const session = await currentGuardianSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireStaffPage(): Promise<StaffSession> {
  const session = await currentStaffSession();
  if (!session) redirect("/login");
  return session;
}

// The branches a list page should show: the switcher's choice if this staff
// member may use it, otherwise everything they can see (empty = all). A choice
// that is no longer one of the academy's branches falls back, as the switcher does.
export async function selectedBranchIds(session: StaffSession): Promise<string[]> {
  const chosen = (await cookies()).get(BRANCH_COOKIE)?.value;
  if (!chosen || chosen === "all") return session.branchIds;
  if (session.branchIds.length) return session.branchIds.includes(chosen) ? [chosen] : session.branchIds;
  const known = await withTenant(session.tenant.id, async (tx) => (await listBranches(tx)).some((b) => b.id === chosen));
  return known ? [chosen] : session.branchIds;
}

// /platform lives on the main site only; an academy's address has none.
export async function currentPlatformSession(): Promise<PlatformSession | undefined> {
  if (slugFromHost((await headers()).get("host"))) notFound();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getPlatformSessionFromToken(token) : undefined;
}

export async function requirePlatformPage(): Promise<PlatformSession> {
  const session = await currentPlatformSession();
  if (!session) redirect("/platform/login");
  return session;
}
