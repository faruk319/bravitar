"use client";

import { useState } from "react";
import { selectClass } from "@/components/fees/plan-editor";
import { Field, SheetForm, useAction } from "@/components/sheet-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { send } from "@/lib/send";

// The owner's changes on Billing (agreed 2026-09-30): offered modules and plans only.

type Option = { value: string; label: string };
export type PlanOption = Option & { activityKey: string };

const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim();
const WAITS = "A paid module waits for its first payment.";

function Options({ options }: { options: Option[] }) {
  return options.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ));
}

// A module, then one of its plans.
function ModulePlanFields({ id, modules, plans }: { id: string; modules: Option[]; plans: PlanOption[] }) {
  const [key, setKey] = useState(modules[0]?.value ?? "");
  return (
    <>
      <Field label="Module" id={`${id}-module`}>
        <select id={`${id}-module`} name="activityKey" value={key} onChange={(e) => setKey(e.target.value)} className={selectClass}>
          <Options options={modules} />
        </select>
      </Field>
      <Field label="Plan" id={`${id}-plan`}>
        <select key={key} id={`${id}-plan`} name="planId" className={selectClass}>
          <Options options={plans.filter((p) => p.activityKey === key)} />
        </select>
      </Field>
    </>
  );
}

const modulePlan = (f: FormData) => ({ activityKey: text(f, "activityKey"), planId: text(f, "planId") });

// Dearer: now. Cheaper or another cycle: when the paid period ends.
export function ChangePlan({ subscriptionId, title, current, plans }: { subscriptionId: string; title: string; current: string; plans: Option[] }) {
  const a = useAction();
  const id = `${subscriptionId}-plan`;
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Change plan</SheetTrigger>
      <SheetForm
        trigger="Change plan"
        title={title}
        submitLabel="Change plan"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() => send(`/api/billing/subscriptions/${subscriptionId}`, "PATCH", { planId: text(new FormData(e.currentTarget), "plan") }));
        }}
      >
        <p className="text-body text-muted-foreground">A dearer plan starts now, a cheaper one when the paid period ends.</p>
        <Field label="Plan" id={id}>
          <select id={id} name="plan" defaultValue={current} className={selectClass}>
            <Options options={plans} />
          </select>
        </Field>
      </SheetForm>
    </Sheet>
  );
}

export function AddModule({ branchId, branchName, modules, plans }: { branchId: string; branchName: string; modules: Option[]; plans: PlanOption[] }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Add a module</SheetTrigger>
      <SheetForm
        trigger="Add a module"
        title={`Add a module at ${branchName}`}
        submitLabel="Add module"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() => send(`/api/billing/branches/${branchId}/modules`, "POST", modulePlan(new FormData(e.currentTarget))));
        }}
      >
        <p className="text-body text-muted-foreground">{WAITS}</p>
        <ModulePlanFields id={`${branchId}-add`} modules={modules} plans={plans} />
      </SheetForm>
    </Sheet>
  );
}

export function AddBranch({ modules, plans }: { modules: Option[]; plans: PlanOption[] }) {
  const a = useAction();
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Add a branch</SheetTrigger>
      <SheetForm
        trigger="Add a branch"
        title="Add a branch"
        submitLabel="Add branch"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(() => send("/api/billing/branches", "POST", { name: text(f, "name"), ...modulePlan(f) }));
        }}
      >
        <p className="text-body text-muted-foreground">{WAITS}</p>
        <Field label="Name" id="new-branch-name">
          <Input id="new-branch-name" name="name" required autoComplete="off" />
        </Field>
        <ModulePlanFields id="new-branch" modules={modules} plans={plans} />
      </SheetForm>
    </Sheet>
  );
}

export function RenameBranch({ branchId, name }: { branchId: string; name: string }) {
  const a = useAction();
  const id = `${branchId}-name`;
  return (
    <Sheet open={a.open} onOpenChange={a.setOpen}>
      <SheetTrigger render={<Button variant="ghost" />}>Rename</SheetTrigger>
      <SheetForm
        trigger="Rename"
        title={`Rename ${name}`}
        submitLabel="Save name"
        busy={a.busy}
        error={a.error}
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() => send(`/api/billing/branches/${branchId}`, "PATCH", { name: text(new FormData(e.currentTarget), "name") }));
        }}
      >
        <Field label="Name" id={id}>
          <Input id={id} name="name" defaultValue={name} required autoComplete="off" />
        </Field>
      </SheetForm>
    </Sheet>
  );
}
