"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { syncNow } from "@/components/offline/offline-sync";
import { Button } from "@/components/ui/button";
import { queue } from "@/lib/offline/queue";

export function SignOutButton({ variant = "outline", to = "/login" }: { variant?: "outline" | "ghost"; to?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={variant}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          // Marks still on this phone would be lost: send them, or refuse.
          const left = (await syncNow().catch(() => ({ waiting: 0 }))).waiting;
          if (left) {
            setBusy(false);
            return setMsg(`${left} ${left === 1 ? "mark hasn't" : "marks haven't"} synced. Connect to the internet first.`);
          }
          await fetch("/api/auth/logout", { method: "POST" });
          // Cached rosters hold student names.
          await queue.clear().catch(() => {});
          await caches?.delete("bravitar-pages").catch(() => false);
          router.replace(to);
          router.refresh();
        }}
      >
        Sign out
      </Button>
      {msg ? (
        <p role="alert" className="text-label text-danger-600">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
