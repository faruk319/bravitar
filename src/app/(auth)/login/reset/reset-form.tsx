"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Academy } from "@/modules/auth/service";
import { AcademyChoice } from "../academy-choice";

async function post(path: string, body: object): Promise<{ ok: boolean; academies?: Academy[]; error?: string }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { academies?: Academy[]; error?: string };
  return { ok: res.ok, ...data };
}

// Email, then the WhatsApp code and a new password. `common`: the main site,
// where the answer is the academies to go to.
export function ResetForm({ common }: { common: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [academies, setAcademies] = useState<Academy[]>();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const f = new FormData(e.currentTarget);
    if (!sent) {
      const r = await post("/api/auth/reset/code", { email });
      if (r.ok) setSent(true);
      else setError(r.error ?? "Could not send a code");
      setBusy(false);
      return;
    }
    const r = await post("/api/auth/reset", { email, code: f.get("code"), password: f.get("password") });
    if (r.ok && !common) {
      router.replace("/");
      router.refresh();
      return;
    }
    if (r.ok && r.academies?.[0]) {
      if (r.academies.length === 1) return window.location.assign(r.academies[0].url);
      setAcademies(r.academies);
    } else setError(r.error ?? "Could not set the password");
    setBusy(false);
  }

  if (academies) return <AcademyChoice academies={academies} />;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={sent} autoFocus required />
      </div>
      {sent ? (
        <>
          <p className="text-caption text-muted-foreground">We sent a 6-digit code on WhatsApp to the phone on your account. No code? Ask your academy owner for a new link.</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy}>
        {sent ? (busy ? "Saving…" : "Set password") : busy ? "Sending…" : "Send code"}
      </Button>
      <Link href="/login" className="self-center text-label text-accent-600">
        Back to sign in
      </Link>
    </form>
  );
}
