"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { CopyText } from "@/components/copy-text";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
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

export type PlanOption = Option & { activityKey: string };

// plans: offered ones first, cheapest first; the first of the type's is the default.
export function NewAcademyForm({ types, plans, domain }: { types: Option[]; plans: PlanOption[]; domain: string }) {
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [type, setType] = useState("general");
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
      verticalPreset: type,
      ...(f.get("plan") ? { planId: f.get("plan") } : {}),
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
        <select id="type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="text-caption text-muted-foreground">Also its first activity, on trial</span>
      </Field>
      <Field label="Plan" id="plan">
        <select key={type} id="plan" name="plan" className={selectClass}>
          {plans
            .filter((p) => p.activityKey === type)
            .map((p) => (
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

// Sign in as the owner for 2 hours, with a reason; every change is tagged.
export function OpenAsOwner({ academyId, owner }: { academyId: string; owner: string }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Open as owner</SheetTrigger>
      <SheetForm
        trigger="Open as owner"
        title={`Open as ${owner}`}
        submitLabel="Open"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
          let url = "";
          void a.run(
            async () => {
              const r = await request<{ url: string }>(`/api/platform/academies/${academyId}/impersonate`, "POST", { reason });
              if (r.error !== undefined) return r.error;
              url = r.data.url;
              return undefined;
            },
            () => window.location.assign(url),
          );
        }}
      >
        <p className="text-body text-muted-foreground">2 hours. Every change is tagged with your name.</p>
        <Field label="Reason" id="impersonate-reason">
          <Input id="impersonate-reason" name="reason" required autoComplete="off" />
        </Field>
      </SheetForm>
    </Sheet>
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
          Save features
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

export type ActivityRowData = { key: string; name: string; description: string; icon: string; status: string; trialDays: string };

// One module in the catalog: its name, icon, trial length (blank: the default)
// and whether academies can have it.
export function ActivityRow({ a, statuses, icons, defaultTrialDays }: { a: ActivityRowData; statuses: Option[]; icons: Option[]; defaultTrialDays: number }) {
  const s = useSave();
  const [initial] = useState(a); // after a save the fields already hold what was saved
  const id = (f: string) => `${a.key}-${f}`;
  return (
    <form
      className="grid grid-cols-2 items-end gap-2 pb-3 md:grid-cols-[1fr_2fr_10rem_7rem_9rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void s.save(`/api/platform/activities/${a.key}`, "PATCH", { name: f.get("name"), description: f.get("description"), icon: f.get("icon"), trialDays: f.get("trialDays"), status: f.get("status") });
      }}
    >
      <Field label="Module" id={id("name")}>
        <Input id={id("name")} name="name" defaultValue={initial.name} />
      </Field>
      <Field label="Description" id={id("description")}>
        <Input id={id("description")} name="description" defaultValue={initial.description} />
      </Field>
      <Field label="Icon" id={id("icon")}>
        <select id={id("icon")} name="icon" defaultValue={initial.icon} className={selectClass}>
          {icons.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Trial days" id={id("trialDays")}>
        <Input id={id("trialDays")} name="trialDays" inputMode="numeric" placeholder={String(defaultTrialDays)} defaultValue={initial.trialDays} />
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
      <Button type="submit" variant="outline" size="lg" disabled={s.busy}>
        Save
      </Button>
      {s.error || s.done ? (
        <div className="col-span-full">
          <Feedback error={s.error} done={s.done} />
        </div>
      ) : null}
    </form>
  );
}

export type PlanValues = { name: string; price: string; billingInterval: string; maxStudents: string; maxStaff: string; isOffered: boolean };
export type PlanRowData = PlanValues & { id: string; isDefault: boolean; used: string; changes: string[] };

const PLAN_GRID = "grid grid-cols-2 items-end gap-2 py-3 md:grid-cols-[1fr_7rem_7rem_6rem_6rem_7rem_1fr_7rem]";
const planBody = (f: FormData) => ({
  name: f.get("name"),
  price: f.get("price"),
  billingInterval: f.get("billingInterval"),
  maxStudents: f.get("maxStudents"),
  maxStaff: f.get("maxStaff"),
  isOffered: f.get("isOffered") === "on",
});

function PlanFields({ prefix, v }: { prefix: string; v: PlanValues }) {
  const id = (f: string) => `${prefix}-${f}`;
  return (
    <>
      <Field label="Plan" id={id("name")}>
        <Input id={id("name")} name="name" defaultValue={v.name} />
      </Field>
      <Field label="Price ₹" id={id("price")}>
        <Input id={id("price")} name="price" inputMode="decimal" defaultValue={v.price} />
      </Field>
      <Field label="Every" id={id("cycle")}>
        <select id={id("cycle")} name="billingInterval" defaultValue={v.billingInterval} className={selectClass}>
          <option value="month">Month</option>
          <option value="year">Year</option>
        </select>
      </Field>
      <Field label="Students" id={id("students")}>
        <Input id={id("students")} name="maxStudents" inputMode="numeric" placeholder="No limit" defaultValue={v.maxStudents} />
      </Field>
      <Field label="Staff" id={id("staff")}>
        <Input id={id("staff")} name="maxStaff" inputMode="numeric" placeholder="No limit" defaultValue={v.maxStaff} />
      </Field>
      <label className="flex min-h-12 items-center gap-2 text-body">
        <input type="checkbox" name="isOffered" defaultChecked={v.isOffered} className="size-5 accent-accent-600" /> Offered
      </label>
    </>
  );
}

// A plan's new price or cycle is for activities started from now on; new
// limits apply to everyone on it. Not offered: owners can't pick it, you still can.
export function PlanRow({ p }: { p: PlanRowData }) {
  const s = useSave();
  const [initial] = useState(p);
  const [reason, setReason] = useState("");
  return (
    <form
      className={PLAN_GRID}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await s.save(`/api/platform/plans/${p.id}`, "PATCH", { ...planBody(new FormData(e.currentTarget)), reason })) setReason("");
      }}
    >
      <PlanFields prefix={p.id} v={initial} />
      <Field label="Reason for a new price" id={`${p.id}-reason`}>
        <Input id={`${p.id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" size="lg" disabled={s.busy}>
        Save
      </Button>
      <div className="col-span-full flex flex-wrap items-center gap-x-3">
        {p.isDefault ? <span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-label text-accent-600">Default</span> : p.isOffered ? <MakeDefault planId={p.id} /> : null}
        <p className="text-caption text-muted-foreground">{p.used}</p>
        <Feedback error={s.error} done={s.done} />
        {p.changes.length ? <p className="text-caption text-muted-foreground">{p.changes.join(" · ")}</p> : null}
      </div>
    </form>
  );
}

// The plan a new start of its module gets when none is picked.
function MakeDefault({ planId }: { planId: string }) {
  const s = useSave();
  return (
    <>
      <Button type="button" variant="ghost" size="sm" disabled={s.busy} onClick={() => void s.save(`/api/platform/plans/${planId}/default`, "POST", {})}>
        Make default
      </Button>
      <Feedback error={s.error} done={false} />
    </>
  );
}

export function AddPlanRow({ activityKey }: { activityKey: string }) {
  const s = useSave();
  const [round, setRound] = useState(0); // an empty row again after each add
  return (
    <form
      key={round}
      className={PLAN_GRID}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await s.save(`/api/platform/activities/${activityKey}/plans`, "POST", planBody(new FormData(e.currentTarget)))) setRound((r) => r + 1);
      }}
    >
      <PlanFields prefix={`${activityKey}-new`} v={{ name: "", price: "", billingInterval: "month", maxStudents: "", maxStaff: "", isOffered: true }} />
      <span />
      <Button type="submit" variant="outline" size="lg" disabled={s.busy}>
        Add plan
      </Button>
      {s.error ? (
        <div className="col-span-full">
          <Feedback error={s.error} done={false} />
        </div>
      ) : null}
    </form>
  );
}

// An academy's activity moves plan: up now, down at the end of the paid month.
export function PlanChangeForm({ subscriptionId, current, plans }: { subscriptionId: string; current: string; plans: Option[] }) {
  const s = useSave();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void s.save(`/api/platform/subscriptions/${subscriptionId}`, "PATCH", { planId: new FormData(e.currentTarget).get("plan") });
      }}
    >
      <select name="plan" aria-label="Plan" defaultValue={current} className={selectClass}>
        {plans.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="lg" disabled={s.busy}>
        Change plan
      </Button>
      <Feedback error={s.error} done={s.done} />
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
      <Field label="Default trial days" id="trialDays">
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
