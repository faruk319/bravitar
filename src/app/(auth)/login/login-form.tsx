"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Academy } from "@/modules/auth/service";

// On an academy's address: that academy. On the main site (`common`): every
// academy this email and password open, straight in when there is one.
export function LoginForm({ common = false }: { common?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [academies, setAcademies] = useState<Academy[]>();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(e.currentTarget);
    const res = await fetch(common ? "/api/auth/sign-in" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    const body = (await res.json().catch(() => ({}))) as { academies?: Academy[]; error?: string };
    if (res.ok && !common) {
      router.replace("/");
      router.refresh();
      return;
    }
    if (res.ok && body.academies?.[0]) {
      if (body.academies.length === 1) return window.location.assign(body.academies[0].url);
      setAcademies(body.academies);
      setBusy(false);
      return;
    }
    setError(body.error ?? "Could not sign in");
    setBusy(false);
  }

  if (academies) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-label">Choose academy</p>
        {academies.map((a) => (
          <Button key={a.url} variant="outline" size="lg" nativeButton={false} render={<a href={a.url} />}>
            {a.name}
          </Button>
        ))}
      </div>
    );
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
