import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { currentGuardianSession, currentStaffSession } from "@/lib/auth/server";
import { homeFor, shellFor } from "@/lib/auth/shell";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { slugFromHost } from "@/modules/auth/routes";
import { PAUSED } from "@/modules/auth/service";
import { LoginForm } from "./login-form";

// docs/07 §7.9. On an academy's address, that academy; on the main site, the
// common login for every academy (agreed 2026-09-25).
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Already signed in (a live session, not just a cookie): go home.
  const session = await currentStaffSession();
  if (session) redirect(homeFor(shellFor(session)));
  if (await currentGuardianSession()) redirect("/portal");
  const slug = slugFromHost((await headers()).get("host"));
  const tenant = slug ? await resolveTenantBySlug(slug) : undefined;
  if (slug && !tenant) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-display">No academy here</h1>
        <p className="text-body text-muted-foreground">Check the address you were given.</p>
      </main>
    );
  }
  if (tenant?.status === "suspended") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-display">{tenant.name}</h1>
        <p className="text-body text-muted-foreground">{PAUSED}</p>
      </main>
    );
  }
  const expired = (await searchParams).expired === "1";
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-4">
      <Card className="flex flex-col gap-6 p-6 md:p-8">
        <div>
          <p className="text-caption text-muted-foreground">{tenant?.name ?? "Bravitar"}</p>
          <h1 className="text-display">Sign in</h1>
          {expired ? <p className="mt-1 text-label text-danger-600">That sign-in link has expired. Sign in again.</p> : null}
        </div>
        <LoginForm common={!tenant} />
      </Card>
    </main>
  );
}
