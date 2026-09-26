"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizePhone } from "@/lib/phone";
import type { Academy } from "@/modules/auth/service";
import { AcademyChoice } from "./academy-choice";

type Step = { kind: "who" } | { kind: "password"; email: string } | { kind: "code"; phone: string };

const post = async (url: string, body: object) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as { academies?: Academy[]; error?: string } };
};

// One box (agreed 2026-09-25): an email goes on to a password (staff), a phone
// number to a WhatsApp code (parents and adult students). On an academy's
// address it signs in there; on the main site (`common`) every academy it
// opens, straight in when there is one.
export function LoginForm({ common = false }: { common?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "who" });
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [academies, setAcademies] = useState<Academy[]>();

  async function send(phone: string) {
    const r = await post("/api/auth/code", { phone });
    if (!r.ok) throw new Error(r.body.error ?? "Could not send a code");
  }

  function done(r: Awaited<ReturnType<typeof post>>, home: string) {
    if (r.ok && !common) {
      router.replace(home);
      router.refresh();
      return;
    }
    if (r.ok && r.body.academies?.[0]) {
      if (r.body.academies.length === 1) return window.location.assign(r.body.academies[0].url);
      setAcademies(r.body.academies);
      setBusy(false);
      return;
    }
    setError(r.body.error ?? "Could not sign in");
    setBusy(false);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(e.currentTarget);
    try {
      if (step.kind === "who") {
        const who = String(form.get("who") ?? "").trim();
        const phone = who.includes("@") ? undefined : normalizePhone(who);
        if (who.includes("@")) setStep({ kind: "password", email: who });
        else if (phone) {
          await send(phone);
          setStep({ kind: "code", phone });
        } else setError("Enter your phone number or email");
        setBusy(false);
      } else if (step.kind === "password") {
        done(await post(common ? "/api/auth/sign-in" : "/api/auth/login", { email: step.email, password: form.get("password") }), "/");
      } else {
        done(await post("/api/auth/verify", { phone: step.phone, code: form.get("code") }), "/portal");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  if (academies) return <AcademyChoice academies={academies} />;

  const back = (
    <button type="button" className="text-label text-accent-600" onClick={() => (setStep({ kind: "who" }), setError(undefined))}>
      Change
    </button>
  );
  const alert = error ? (
    <p role="alert" className="text-label text-danger-600">
      {error}
    </p>
  ) : null;

  return (
    <form key={step.kind} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {step.kind === "who" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="who">Phone number or email</Label>
          <Input id="who" name="who" type="text" autoComplete="username" autoCapitalize="none" autoFocus required aria-invalid={error ? true : undefined} />
          {alert}
        </div>
      ) : step.kind === "password" ? (
        <>
          <p className="flex items-center justify-between gap-2 text-body">
            <span className="truncate">{step.email}</span> {back}
          </p>
          <input type="hidden" name="username" autoComplete="username" value={step.email} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required aria-invalid={error ? true : undefined} />
            {alert}
          </div>
        </>
      ) : (
        <>
          <p className="flex items-center justify-between gap-2 text-body">
            <span>Code sent on WhatsApp to ····{step.phone.slice(-4)}</span> {back}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">6-digit code</Label>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required aria-invalid={error ? true : undefined} />
            {alert}
          </div>
        </>
      )}
      <Button type="submit" size="lg" disabled={busy} className="mt-2">
        {busy ? "Please wait…" : step.kind === "who" ? "Continue" : "Sign in"}
      </Button>
      {step.kind === "password" ? (
        <Link href="/login/reset" className="self-center text-label text-accent-600">
          Forgot password?
        </Link>
      ) : step.kind === "code" ? (
        <button type="button" className="self-center text-label text-accent-600" disabled={busy} onClick={() => send(step.phone).then(() => setError("A new code is on its way"), (err: Error) => setError(err.message))}>
          Send the code again
        </button>
      ) : null}
    </form>
  );
}
