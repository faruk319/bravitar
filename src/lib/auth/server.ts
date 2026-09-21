import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./cookie";
import { getStaffSessionFromToken, type StaffSession } from "./session";

// Server-component side of the session. Route handlers use getStaffSession(req).
export async function currentStaffSession(): Promise<StaffSession | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getStaffSessionFromToken(token) : undefined;
}

export async function requireStaffPage(): Promise<StaffSession> {
  const session = await currentStaffSession();
  if (!session) redirect("/login");
  return session;
}
