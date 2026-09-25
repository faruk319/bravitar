"use client";

import { useState } from "react";
import { CopyText } from "@/components/copy-text";
import { useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { send } from "@/lib/send";
import type { TemplateView } from "@/modules/messaging/service";
import { AUTOMATED_KEYS, toMetaTemplate } from "@/modules/messaging/templates";

// docs/03 §10: each template's wording is editable, and it can be turned off.
// The page keys it by what is saved, so each saved change starts fresh.
export function TemplateEditor({ t }: { t: TemplateView }) {
  const a = useAction();
  const named = useAction(); // the Meta name, with its error by its input
  const [body, setBody] = useState(t.body);
  const [metaName, setMetaName] = useState(t.providerTemplateName ?? "");
  const patch = (action: typeof a, change: object) => void action.run(() => send(`/api/messages/templates/${t.key}`, "PATCH", change));
  const save = (change: object) => patch(a, change);
  const meta = AUTOMATED_KEYS.includes(t.key) ? toMetaTemplate(t.body) : undefined;
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
          <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => save({ reset: true })}>
            Reset to default
          </Button>
        ) : null}
      </div>
      {meta ? (
        <details className="mt-4 border-t border-neutral-100 pt-3">
          <summary className="cursor-pointer text-label">WhatsApp template{t.providerTemplateName ? ` · ${t.providerTemplateName}` : " · not set"}</summary>
          <div className="mt-3 flex flex-col gap-2">
            <CopyText text={meta.text} wrap />
            <p className="text-caption text-muted-foreground">
              Utility · language {t.language}
              {meta.edge ? " · Meta refuses a {{…}} at the start or end" : ""}
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                patch(named, { providerTemplateName: metaName.trim() });
              }}
            >
              <Input aria-label="Approved name in Meta" placeholder="Approved name in Meta" value={metaName} onChange={(e) => setMetaName(e.target.value)} autoComplete="off" spellCheck={false} />
              <Button type="submit" size="sm" variant="outline" disabled={named.busy || metaName.trim() === (t.providerTemplateName ?? "")}>
                Save
              </Button>
            </form>
            {named.error ? (
              <p role="alert" className="text-label text-danger-600">
                {named.error}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </Card>
  );
}
