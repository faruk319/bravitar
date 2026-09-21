"use client";

import { EmptyState } from "@/components/empty-state";
import { type LabelKey, type LabelPack, LABEL_KEYS } from "@/lib/tenant/labels";
import { useLabels } from "./tenant-provider";

// Fills {student.one} / {student.many} from the tenant's label pack.
export function fillLabels(template: string, labels: LabelPack): string {
  return template.replace(/\{(\w+)\.(one|many)\}/g, (m, key: string, form: "one" | "many") =>
    (LABEL_KEYS as readonly string[]).includes(key) ? labels[key as LabelKey][form] : m,
  );
}

export function useLabelText(template: string): string {
  return fillLabels(template, useLabels());
}

export function Placeholder({ title, hint, action }: { title: string; hint: string; action: string }) {
  return <EmptyState title={useLabelText(title)} hint={useLabelText(hint)} action={useLabelText(action)} soon />;
}

export function PageTitle({ children }: { children: string }) {
  return <h1 className="mb-4 text-display">{useLabelText(children)}</h1>;
}
