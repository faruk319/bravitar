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
  const save = async (path: string, method: string, body: unknown) => {
    setBusy(true);
    setError(undefined);
    setDone(false);
    const err = await send(path, method, body);
    setBusy(false);
    if (err) return setError(err);
    setDone(true);
    router.refresh();
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

export function NewAcademyForm({ types, plans, domain }: { types: Option[]; plans: Option[]; domain: string }) {
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
      planCode: f.get("plan"),
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
      </Field>
      <Field label="Plan" id="plan">
        <select id="plan" name="plan" className={selectClass}>
          {plans.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
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

// One branch's own plan and status (agreed 2026-09-26).
export function BranchPlanForm({ branchId, plans, statuses, plan, status }: { branchId: string; plans: Option[]; statuses: Option[]; plan: string; status: string }) {
  const s = useSave();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void s.save(`/api/platform/branches/${branchId}`, "PATCH", { planCode: f.get("plan"), status: f.get("status") });
      }}
    >
      <Field label="Plan" id={`${branchId}-plan`}>
        <select id={`${branchId}-plan`} name="plan" defaultValue={plan} className={selectClass}>
          {plans.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status" id={`${branchId}-status`}>
        <select id={`${branchId}-status`} name="status" defaultValue={status} className={selectClass}>
          {statuses.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" variant="outline" size="lg" disabled={s.busy}>
        Save
      </Button>
      <Feedback error={s.error} done={s.done} />
    </form>
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

export type PlanRowData = { code: string; name: string; price: string; maxStudents: number | null; isActive: boolean };

export function PlanRow({ p }: { p: PlanRowData }) {
  const s = useSave();
  const num = (v: number | null) => (v === null ? "" : String(v));
  return (
    <form
      className="grid grid-cols-2 items-end gap-2 py-3 md:grid-cols-[1fr_7rem_9rem_auto_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void s.save(`/api/platform/plans/${p.code}`, "PATCH", { name: f.get("name"), price: f.get("price"), maxStudents: f.get("maxStudents"), isActive: f.get("isActive") === "on" });
      }}
    >
      <Field label={`Name · ${p.code}`} id={`${p.code}-name`}>
        <Input id={`${p.code}-name`} name="name" defaultValue={p.name} />
      </Field>
      <Field label="Price ₹/month" id={`${p.code}-price`}>
        <Input id={`${p.code}-price`} name="price" inputMode="decimal" defaultValue={p.price} />
      </Field>
      <Field label="Students per branch" id={`${p.code}-s`}>
        <Input id={`${p.code}-s`} name="maxStudents" inputMode="numeric" placeholder="No limit" defaultValue={num(p.maxStudents)} />
      </Field>
      <label className="flex min-h-12 items-center gap-2 text-body">
        <input type="checkbox" name="isActive" defaultChecked={p.isActive} className="size-5 accent-accent-600" /> Offered
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" size="lg" disabled={s.busy}>
          Save
        </Button>
        <Feedback error={s.error} done={s.done} />
      </div>
    </form>
  );
}
