import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { currentStaffSession } from "@/lib/auth/server";
import { homeFor, shellFor } from "@/lib/auth/shell";
import { slugFromHost } from "@/modules/auth/routes";

// Tenant subdomain: straight into the shell, or to login. Bare domain: landing.
export default async function Home() {
  const slug = slugFromHost((await headers()).get("host"));
  if (slug) {
    const session = await currentStaffSession();
    redirect(session ? homeFor(shellFor(session)) : "/login");
  }
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <h1 className="text-display">Bravitar</h1>
      <p className="text-body text-muted-foreground">Students, batches, attendance and fees for academies.</p>
      <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
        Sign in
      </Button>
    </main>
  );
}
