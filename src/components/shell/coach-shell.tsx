"use client";

import type { ReactNode } from "react";
import { OfflineBanner, SyncBadge } from "@/components/offline/offline-sync";
import type { NavItem } from "@/lib/auth/nav";
import { BranchSwitcher } from "./branch-switcher";
import { NavLink } from "./nav-link";

// docs/07 §3: three items, 56px, icon + label. The primary action of each
// screen sits above this bar, in the thumb zone.
export function CoachShell({ items, children }: { items: NavItem[]; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-16 items-center gap-2 border-b border-neutral-100 bg-background px-4">
        <SyncBadge />
        <BranchSwitcher className="ml-auto" />
      </header>
      <OfflineBanner />
      <main className="flex-1 px-4 pt-4 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid h-[calc(3.5rem+env(safe-area-inset-bottom,0px))] border-t border-neutral-100 bg-background pb-[env(safe-area-inset-bottom,0px)]" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((item) => (
          <BottomItem key={item.href} item={item} />
        ))}
      </nav>
    </div>
  );
}

function BottomItem({ item }: { item: NavItem }) {
  return (
    <div className="[&_a]:h-14 [&_a]:flex-col [&_a]:gap-0.5 [&_a]:rounded-none [&_a]:px-0 [&_a]:text-caption [&_a]:justify-center [&_a[aria-current=page]]:bg-transparent">
      <NavLink item={item} />
    </div>
  );
}
