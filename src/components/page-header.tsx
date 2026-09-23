"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useLabelText } from "@/components/shell/placeholder";

type Crumb = { label: string; href: string };

// docs/07 §4: breadcrumb, title, and the page's actions on the right.
// Title and crumbs may use label templates like {student.many}.
export function PageHeader({ title, crumbs = [], actions, children }: { title: string; crumbs?: Crumb[]; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs.length ? (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
            {crumbs.map((c) => (
              <CrumbLink key={c.href} crumb={c} />
            ))}
          </nav>
        ) : null}
        <h1 className="text-display">{useLabelText(title)}</h1>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

function CrumbLink({ crumb }: { crumb: Crumb }) {
  return (
    <>
      <Link href={crumb.href} className="text-accent-600 hover:underline">
        {useLabelText(crumb.label)}
      </Link>
      <span aria-hidden>/</span>
    </>
  );
}
