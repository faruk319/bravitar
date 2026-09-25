"use client";

import { useState } from "react";
import { useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { send } from "@/lib/send";
import type { TemplateView } from "@/modules/messaging/service";

// docs/03 §10: each template's wording is editable, and it can be turned off.
// The page keys it by body and on/off, so each saved change starts fresh.
export function TemplateEditor({ t }: { t: TemplateView }) {
  const a = useAction();
  const [body, setBody] = useState(t.body);
  const save = (patch: object) => void a.run(() => send(`/api/messages/templates/${t.key}`, "PATCH", patch));
  return (
    <Card className={t.isActive ? undefined : "opacity-70"}>
      <CardHeader
        title={t.label}
        action={
          <label className="flex min-h-10 items-center gap-2 text-label">
            <input type="checkbox" checked={t.isActive} disabled={a.busy} onChange={(e) => save({ isActive: e.target.checked })} className="size-5 accent-accent-600" />
            {t.isActive ? "On" : "Off"}
          </label>
        }
      />
      <textarea aria-label={`${t.label} wording`} value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body" />
      <p className="mt-1 text-caption text-muted-foreground">{t.variables.map((v) => `{{${v}}}`).join(" ")}</p>
      {a.error ? (
        <p role="alert" className="mt-2 text-label text-danger-600">
          {a.error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={a.busy || body === t.body} onClick={() => save({ body })}>
          Save
        </Button>
        {!t.isDefault ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={a.busy}
            onClick={() => save({ reset: true })}
          >
            Reset to default
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
