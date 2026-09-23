"use client";

import Link from "next/link";
import { useState } from "react";
import { Field } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { send } from "@/lib/send";

export function SetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body text-success-600">✓ Password set.</p>
        <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
          Sign in
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("again")) return setError("The two passwords don't match");
        setBusy(true);
        const err = await send("/api/invite", "POST", { token, password: f.get("password") });
        setBusy(false);
        if (err) return setError(err);
        setDone(true);
      }}
    >
      <Field label="New password" id="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus />
      </Field>
      <Field label="Type it again" id="again">
        <Input id="again" name="again" type="password" autoComplete="new-password" required />
      </Field>
      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
