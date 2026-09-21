import { headers } from "next/headers";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { slugFromHost } from "@/modules/auth/routes";
import { LoginForm } from "./login-form";

// docs/07 §7.9. The academy comes from the subdomain.
export default async function LoginPage() {
  const slug = slugFromHost((await headers()).get("host"));
  const tenant = slug ? await resolveTenantBySlug(slug) : undefined;
  if (!tenant) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-display">No academy here</h1>
        <p className="text-body text-muted-foreground">Check the address you were given.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div>
        <p className="text-caption text-muted-foreground">{tenant.name}</p>
        <h1 className="text-display">Sign in</h1>
      </div>
      <LoginForm />
    </main>
  );
}
