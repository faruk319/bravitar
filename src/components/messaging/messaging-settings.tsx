"use client";

import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { send } from "@/lib/send";
import { QUIET_FROM, QUIET_UNTIL } from "@/modules/messaging/schedule";
import type { MessagingSettings as Settings } from "@/modules/messaging/service";

const LANGUAGE_NAMES = { en: "English", hi: "हिन्दी (Hindi)", mr: "मराठी (Marathi)" } as const;
const HOURS = Array.from({ length: QUIET_FROM - QUIET_UNTIL }, (_, i) => i + QUIET_UNTIL);
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

// docs/03 §10: language, when automated messages go, and a daily limit.
export function MessagingSettings({ settings }: { settings: Settings }) {
  const a = useAction();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex max-w-md flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setSaved(false);
        void a.run(
          () =>
            send("/api/settings/messaging", "PATCH", {
              language: f.get("language"),
              sendHour: Number(f.get("sendHour")),
              absenceHour: Number(f.get("absenceHour")),
              dailyCap: Number(f.get("dailyCap")),
            }),
          () => {
            setSaved(true);
            a.router.refresh();
          },
        );
      }}
    >
      <Field label="Language" id="msg-language">
        <select id="msg-language" name="language" defaultValue={settings.language} className={selectClass}>
          {Object.entries(LANGUAGE_NAMES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fee reminders at" id="msg-send-hour">
          <select id="msg-send-hour" name="sendHour" defaultValue={settings.sendHour} className={selectClass}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hour(h)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Absent messages at" id="msg-absence-hour">
          <select id="msg-absence-hour" name="absenceHour" defaultValue={settings.absenceHour} className={selectClass}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hour(h)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Most messages a day" id="msg-cap">
        <Input id="msg-cap" name="dailyCap" type="number" inputMode="numeric" min={1} defaultValue={settings.dailyCap} />
      </Field>
      {a.error ? (
        <p role="alert" className="text-label text-danger-600">
          {a.error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={a.busy}>
          {a.busy ? "Saving…" : "Save"}
        </Button>
        {saved ? <span className="text-caption text-success-600">Saved</span> : null}
      </div>
    </form>
  );
}
