"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { send } from "@/lib/send";

// Bravitar support signed in as the owner (Prompt 21), on every page; End signs out.
export function ImpersonationBanner({ owner, reason, back }: { owner: string; reason: string; back: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-600/10 px-3 py-2 text-label text-danger-600">
      <p>
        Bravitar support, signed in as {owner}. Reason: {reason}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await send("/api/auth/logout", "POST");
          window.location.assign(back);
        }}
      >
        End
      </Button>
    </div>
  );
}
