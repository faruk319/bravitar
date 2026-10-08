"use client";

import type { ReactNode } from "react";
import { useSetCrumbLeaf } from "@/components/shell/crumb-leaf";
import { useLabelText } from "@/components/shell/placeholder";

// docs/07 §4: title and the page's actions on the right. Breadcrumbs live in
// the global header; `entity` hands it this title as the trail's last crumb.
export function PageHeader({ title, entity, quiet, actions, children }: { title: string; entity?: boolean; quiet?: boolean; actions?: ReactNode; children?: ReactNode }) {
  const text = useLabelText(title);
  useSetCrumbLeaf(entity ? text : undefined);
  return (
    <div className={quiet ? "mb-3 flex flex-wrap items-center justify-end gap-2" : "mb-5 flex flex-wrap items-end justify-between gap-3"}>
      <div className="min-w-0">
        <h1 className={quiet ? "sr-only" : "text-display"}>{text}</h1>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
