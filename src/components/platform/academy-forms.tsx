"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { CopyText } from "@/components/copy-text";
import { selectClass } from "@/components/fees/plan-editor";
import { Field } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { request, send } from "@/lib/send";

// The /platform forms (Prompt 21). Each saves, then refreshes the page's data.

type Option = { value: string; label: string };

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const save = async (path: string, method: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    setDone(false);
    const err = await send(path, method, body);
    setBusy(false);
    if (err) {
      setError(err);
      return false;
    }
    setDone(true);
    router.refresh();
    return true;
  };
  return { busy, error, done, save };
}

const Feedback = ({ error, done, saved = "Saved" }: { error: string | undefined; done: boolean; saved?: string }) =>
  error ? (
    <p role="alert" className="text-label text-danger-600">
      {error}
    </p>
  ) : done ? (
    <p className="text-label text-success-600">✓ {saved}</p>
  ) : null;

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export function NewAcademyForm({ types, domain }: { types: Option[]; domain: string }) {
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [made, setMade] = useState<{ id: string; inviteUrl: string }>();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    const r = await request<{ id: string; inviteUrl: string }>("/api/platform/academies", "POST", {
      name: f.get("name"),
      slug,
      verticalPreset: f.get("type"),
      owner: { name: f.get("ownerName"), email: f.get("ownerEmail"), ...(f.get("ownerPhone") ? { phone: f.get("ownerPhone") } : {}) },
    });
    setBusy(false);
    if (r.error !== undefined) return setError(r.error);
    setMade(r.data);
  }

  if (made) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body text-success-600">✓ Academy created. Send the owner this link to set a password (valid 7 days):</p>
        <CopyText text={made.inviteUrl} />
        <Button variant="outline" nativeButton={false} render={<Link href={`/platform/academies/${made.id}`} />} className="self-start">
          Open the academy
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4" noValidate>
      <Field label="Academy name" id="name">
        <Input id="name" name="name" required onChange={(e) => (touched ? undefined : setSlug(slugOf(e.target.value)))} />
      </Field>
      <Field label="Address" id="slug">
        <Input id="slug" value={slug} onChange={(e) => (setTouched(true), setSlug(slugOf(e.target.value)))} />
        <span className="text-caption text-muted-foreground">{slug || "name"}.{domain}</span>
      </Field>
      <Field label="Type" id="type">
        <select id="type" name="type" className={selectClass} defaultValue="general">
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="text-caption text-muted-foreground">Also its first activity, on trial</span>
      </Field>
      <Field label="Owner's name" id="ownerName">
        <Input id="ownerName" name="ownerName" required />
      </Field>
      <Field label="Owner's email" id="ownerEmail">
        <Input id="ownerEmail" name="ownerEmail" type="email" required />
      </Field>
      <Field label="Owner's phone (optional)" id="ownerPhone">
        <Input id="ownerPhone" name="ownerPhone" inputMode="tel" />
      </Field>
      {error ? (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Creating…" : "Create academy"}
      </Button>
    </form>
  );
}

export function OwnerInvite({ academyId }: { academyId: string }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  return url ? (
    <CopyText text={url} />
  ) : (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        className="self-start"
        onClick={async () => {
          const r = await request<{ inviteUrl: string }>(`/api/platform/academies/${academyId}/invite`, "POST");
          if (r.error !== undefined) setError(r.error);
          else setUrl(r.data.inviteUrl);
        }}
      >
        New invite link
      </Button>
      <Feedback error={error} done={false} />
    </div>
  );
}

export function ModulesForm({ academyId, modules }: { academyId: string; modules: { key: string; label: string; on: boolean }[] }) {
  const s = useSave();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void s.save(`/api/platform/academies/${academyId}`, "PATCH", { modules: Object.fromEntries(modules.map((m) => [m.key, f.get(m.key) === "on"])) });
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {modules.map((m) => (
          <label key={m.key} className="flex min-h-11 items-center gap-2 text-body">
            <input type="checkbox" name={m.key} defaultChecked={m.on} className="size-5 accent-accent-600" /> {m.label}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={s.busy}>
          Save modules
        </Button>
        <Feedback error={s.error} done={s.done} />
      </div>
    </form>
  );
}

// Suspend or restore, with the reason kept in both audit logs.
export function AccessForm({ academyId, suspended }: { academyId: string; suspended: boolean }) {
  const s = useSave();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void s.save(`/api/platform/academies/${academyId}`, "PATCH", { status: { status: suspended ? "active" : "suspended", reason: new FormData(e.currentTarget).get("reason") } });
      }}
    >
      <Field label="Reason" id="reason">
        <Input id="reason" name="reason" required className="w-72" />
      </Field>
      <Button type="submit" size="lg" variant={suspended ? "outline" : "destructive"} disabled={s.busy}>
        {suspended ? "Restore" : "Suspend"}
      </Button>
      <Feedback error={s.error} done={s.done} saved={suspended ? "Suspended" : "Restored"} />
    </form>
  );
}

export type ActivityRowData = { key: string; name: string; description: string; price: string; status: string; used: string; changes: string[] };

// One activity in the catalog. A new price is for activities started from now on.
export function ActivityRow({ a, statuses }: { a: ActivityRowData; statuses: Option[] }) {
  const s = useSave();
  const [initial] = useState(a); // after a save the fields already hold what was saved
  const [reason, setReason] = useState("");
  const id = (f: string) => `${a.key}-${f}`;
  return (
    <form
      className="grid grid-cols-2 items-end gap-2 py-3 md:grid-cols-[1fr_1.4fr_7rem_9rem_1fr_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (await s.save(`/api/platform/activities/${a.key}`, "PATCH", { name: f.get("name"), description: f.get("description"), price: f.get("price"), status: f.get("status"), reason })) setReason("");
      }}
    >
      <Field label={`Name · ${a.used}`} id={id("name")}>
        <Input id={id("name")} name="name" defaultValue={initial.name} />
      </Field>
      <Field label="Description" id={id("description")}>
        <Input id={id("description")} name="description" defaultValue={initial.description} />
      </Field>
      <Field label="₹/month" id={id("price")}>
        <Input id={id("price")} name="price" inputMode="decimal" defaultValue={initial.price} />
      </Field>
      <Field label="Status" id={id("status")}>
        <select id={id("status")} name="status" defaultValue={initial.status} className={selectClass}>
          {statuses.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason for a new price" id={id("reason")}>
        <Input id={id("reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" size="lg" disabled={s.busy}>
        Save
      </Button>
      {s.error || s.done || a.changes.length ? (
        <div className="col-span-full flex flex-wrap items-baseline gap-x-3">
          <Feedback error={s.error} done={s.done} />
          {a.changes.length ? <p className="text-caption text-muted-foreground">{a.changes.join(" · ")}</p> : null}
        </div>
      ) : null}
    </form>
  );
}

export type SettingsData = { graceDays: number; trialDays: number; taxPercent: string; gstin: string; howToPay: string };

// Grace before an unpaid activity pauses, the first activity's trial, tax, and
// how academies pay you.
export function BillingSettingsForm({ v: fresh }: { v: SettingsData }) {
  const s = useSave();
  const [v] = useState(fresh); // after a save the fields already hold what was saved
  return (
    <form
      className="grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void s.save("/api/platform/billing-settings", "PATCH", Object.fromEntries(["graceDays", "trialDays", "taxPercent", "gstin", "howToPay"].map((k) => [k, f.get(k)])));
      }}
    >
      <Field label="Grace days" id="graceDays">
        <Input id="graceDays" name="graceDays" inputMode="numeric" defaultValue={v.graceDays} />
      </Field>
      <Field label="Trial days" id="trialDays">
        <Input id="trialDays" name="trialDays" inputMode="numeric" defaultValue={v.trialDays} />
      </Field>
      <Field label="Tax %" id="taxPercent">
        <Input id="taxPercent" name="taxPercent" inputMode="decimal" defaultValue={v.taxPercent} />
      </Field>
      <Field label="GSTIN" id="gstin">
        <Input id="gstin" name="gstin" defaultValue={v.gstin} />
      </Field>
      <div className="col-span-full">
        <Field label="How to pay (UPI, bank)" id="howToPay">
          <textarea id="howToPay" name="howToPay" rows={3} defaultValue={v.howToPay} className="rounded-lg border border-border bg-background px-3 py-2 text-body" />
        </Field>
      </div>
      <div className="col-span-full flex items-center gap-3">
        <Button type="submit" variant="outline" size="lg" disabled={s.busy}>
          Save settings
        </Button>
        <Feedback error={s.error} done={s.done} />
      </div>
    </form>
  );
}
