import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BRANCH_COOKIE } from "./branch-cookie";
import { SESSION_COOKIE } from "./cookie";
import { type GuardianSession, getGuardianSessionFromToken, getStaffSessionFromToken, type StaffSession } from "./session";

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
// member may use it, otherwise everything they can see (empty = all).
export async function selectedBranchIds(session: StaffSession): Promise<string[]> {
  const chosen = (await cookies()).get(BRANCH_COOKIE)?.value;
  if (chosen && chosen !== "all" && (!session.branchIds.length || session.branchIds.includes(chosen))) return [chosen];
  return session.branchIds;
}
