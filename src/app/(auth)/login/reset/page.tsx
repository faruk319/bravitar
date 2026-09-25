import { headers } from "next/headers";
import { Card } from "@/components/ui/card";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { slugFromHost } from "@/modules/auth/routes";
import { ResetForm } from "./reset-form";

// Forgot password (agreed 2026-09-25): a code on WhatsApp, then a new password.
export default async function ResetPage() {
  const slug = slugFromHost((await headers()).get("host"));
  const tenant = slug ? await resolveTenantBySlug(slug) : undefined;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-4">
      <Card className="flex flex-col gap-6 p-6 md:p-8">
        <div>
          <p className="text-caption text-muted-foreground">{tenant?.name ?? "Bravitar"}</p>
          <h1 className="text-display">Forgot password</h1>
        </div>
        <ResetForm common={!tenant} />
      </Card>
    </main>
  );
}
