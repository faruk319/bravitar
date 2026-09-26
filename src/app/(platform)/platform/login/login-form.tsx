"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Email and password first, then the 6-digit code from the authenticator app;
// all three go to the server together, so a failure never says which was wrong.
export function PlatformLoginForm() {
  const router = useRouter();
  const [who, setWho] = useState<{ email: string; password: string }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const form = new FormData(e.currentTarget);
    if (!who) return setWho({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
    setBusy(true);
    const res = await fetch("/api/platform/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...who, code: form.get("code") }) });
    if (res.ok) {
      router.replace("/platform");
      router.refresh();
      return;
    }
    setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not sign in");
    setBusy(false);
  }

  return (
    <form key={who ? "code" : "who"} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {who ? (
        <>
          <p className="flex items-center justify-between gap-2 text-body">
            <span className="truncate">{who.email}</span>
            <button type="button" className="text-label text-accent-600" onClick={() => (setWho(undefined), setError(undefined))}>
              Change
            </button>
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Code from your authenticator app</Label>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required aria-invalid={error ? true : undefined} />
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" autoFocus required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy} className="mt-2">
        {busy ? "Signing in…" : who ? "Sign in" : "Continue"}
      </Button>
    </form>
  );
}
