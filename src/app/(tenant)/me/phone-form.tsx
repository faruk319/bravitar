"use client";

import { useState } from "react";
import { Field, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/phone";
import { request } from "@/lib/send";

// Where password reset codes go (agreed 2026-09-25). Changing it asks for the
// password, so a session left open can't take the account over.
export function PhoneForm({ phone }: { phone: string | null }) {
  const a = useAction();
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="flex min-h-14 items-center justify-between gap-4 px-4">
        <div className="flex flex-col">
          <span className="text-label text-muted-foreground">Phone for reset codes</span>
          <span className="text-body">{phone ? formatPhone(phone) : "Not set"}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {phone ? "Change" : "Add"}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4 p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void a.run(
          async () => (await request("/api/auth/me/phone", "PATCH", { phone: String(f.get("phone") ?? ""), password: String(f.get("password") ?? "") })).error,
          () => {
            setEditing(false);
            a.router.refresh();
          },
        );
      }}
    >
      <Field label="WhatsApp number" id="me-phone">
        <Input id="me-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={phone ?? ""} />
      </Field>
      <Field label="Your password" id="me-password">
        <Input id="me-password" name="password" type="password" autoComplete="current-password" />
      </Field>
      {a.error ? (
        <p role="alert" className="text-label text-danger-600">
          {a.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={a.busy}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
