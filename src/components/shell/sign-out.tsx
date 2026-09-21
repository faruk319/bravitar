"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SignOutButton({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
