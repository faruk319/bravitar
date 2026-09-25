"use client";

import { type ReactNode, useState } from "react";
import { Field, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { request } from "@/lib/send";

export type KeyField = { name: string; label: string; secret?: boolean; placeholder?: string; numeric?: boolean };

type Props = {
  provider: string;
  path: string; // POST saves; POST <path>/test checks the saved keys again
  fields: KeyField[];
  connected: boolean;
  summary: ReactNode;
  lastError: string | null;
  lastSeen: string;
  intro: string;
  children?: ReactNode;
};

// An academy's own account with a provider (Razorpay, WhatsApp). Saving checks
// the keys with the provider first; secrets are never shown again.
export function Connection({ provider, path, fields, connected, summary, lastError, lastSeen, intro, children }: Props) {
  const a = useAction();
  const [editing, setEditing] = useState(!connected);
  const [tested, setTested] = useState<string>();
  const error = a.error ? (
    <p role="alert" className="text-label text-danger-600">
      {a.error}
    </p>
  ) : null;

  return (
    <div className="flex max-w-md flex-col gap-4">
      {connected ? (
        <div className="flex flex-col gap-1">
          <p className="text-body">{summary}</p>
          {lastError ? (
            <p role="alert" className="text-label text-danger-600">
              {lastError}
            </p>
          ) : tested ? (
            <p className="text-label text-success-600">{tested}</p>
          ) : null}
          <p className="text-caption text-muted-foreground">{lastSeen}</p>
        </div>
      ) : (
        <p className="text-body text-muted-foreground">{intro}</p>
      )}

      {children}

      {editing ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body = Object.fromEntries(fields.map((k) => [k.name, String(f.get(k.name) ?? "")]));
            void a.run(
              async () => (await request(path, "POST", body)).error,
              () => {
                setEditing(false);
                setTested("Keys work");
                a.router.refresh();
              },
            );
          }}
        >
          {fields.map((k) => {
            const id = `${provider}-${k.name}`.toLowerCase();
            return (
              <Field key={k.name} label={k.label} id={id}>
                <Input id={id} name={k.name} type={k.secret ? "password" : "text"} placeholder={k.placeholder} inputMode={k.numeric ? "numeric" : undefined} autoComplete="off" spellCheck={false} />
              </Field>
            );
          })}
          {error}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={a.busy}>
              {a.busy ? `Checking with ${provider}…` : "Test and save"}
            </Button>
            {connected ? (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Keep current keys
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={a.busy}
            onClick={() =>
              void a.run(
                async () => {
                  const r = await request<{ lastError: string | null }>(`${path}/test`, "POST");
                  if (r.data) setTested(r.data.lastError ? undefined : "Keys work");
                  return r.error;
                },
                () => a.router.refresh(),
              )
            }
          >
            {a.busy ? "Testing…" : "Test connection"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Change keys
          </Button>
          {error}
        </div>
      )}
    </div>
  );
}
