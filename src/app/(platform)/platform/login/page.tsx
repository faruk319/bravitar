import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { currentPlatformSession } from "@/lib/auth/server";
import { PlatformLoginForm } from "./login-form";

// Your sign-in (Prompt 21): email, password, then the authenticator code.
export default async function PlatformLoginPage() {
  if (await currentPlatformSession()) redirect("/platform");
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-4">
      <Card className="flex flex-col gap-6 p-6 md:p-8">
        <div>
          <p className="text-caption text-muted-foreground">Bravitar platform</p>
          <h1 className="text-display">Sign in</h1>
        </div>
        <PlatformLoginForm />
      </Card>
    </main>
  );
}
