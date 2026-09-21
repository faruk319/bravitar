"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? "Could not sign in");
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="username" autoFocus required aria-invalid={error ? true : undefined} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={error ? true : undefined} />
        {error ? (
          <p role="alert" className="text-label text-danger-600">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" disabled={busy} className="mt-2">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
