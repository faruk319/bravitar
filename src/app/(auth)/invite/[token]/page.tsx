import { Card } from "@/components/ui/card";
import { inviteInfo } from "@/modules/staff/service";
import { SetPasswordForm } from "./set-password-form";

const REASON = { invalid: "This link isn't valid.", used: "This link was already used.", expired: "This link has expired." } as const;

// Public: the token is the proof (agreed 2026-09-23).
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const info = await inviteInfo(token);
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-4">
      <Card className="flex flex-col gap-6 p-6 md:p-8">
        {info.ok ? (
          <>
            <div>
              <p className="text-caption text-muted-foreground">{info.academy}</p>
              <h1 className="text-display">Hi {info.staffName}</h1>
              <p className="text-body text-muted-foreground">Set a password to sign in as {info.email}.</p>
            </div>
            <SetPasswordForm token={token} />
          </>
        ) : (
          <div>
            <h1 className="text-display">{REASON[info.reason]}</h1>
            <p className="mt-1 text-body text-muted-foreground">Ask the academy for a new link.</p>
          </div>
        )}
      </Card>
    </main>
  );
}
