"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/avatar";
import { OfflineBanner, SyncBadge } from "@/components/offline/offline-sync";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavGroup } from "@/lib/auth/nav";
import { cn } from "@/lib/utils";
import { BranchSwitcher } from "./branch-switcher";
import { CommandSearch } from "./command-search";
import { NavLink } from "./nav-link";
import { useSession, useTenantName } from "./tenant-provider";

const RAIL_KEY = "bravitar.rail";
const RAIL_EVENT = "bravitar:rail";

// Remembered per browser; the server always renders it collapsed.
function useRailExpanded(): [boolean, () => void] {
  const expanded = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(RAIL_EVENT, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(RAIL_EVENT, cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(RAIL_KEY) === "open";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const toggle = () => {
    try {
      localStorage.setItem(RAIL_KEY, expanded ? "closed" : "open");
    } catch {}
    window.dispatchEvent(new Event(RAIL_EVENT));
  };
  return [expanded, toggle];
}

function NavGroups({ groups, compact, onNavigate }: { groups: NavGroup[]; compact?: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.title}>
          {!compact ? <div className="px-3 pb-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">{g.title}</div> : null}
          <div className="flex flex-col gap-0.5">
            {g.items.map((item) => (
              <NavLink key={item.href} item={item} compact={compact} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// docs/07 §4: 64px icon rail that expands to 260px on desktop, state
// remembered; a header with a bottom sheet on phones.
export function AdminShell({ groups, children }: { groups: NavGroup[]; children: ReactNode }) {
  const tenantName = useTenantName();
  const me = useSession().actor.name;
  const [expanded, toggle] = useRailExpanded();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-full">
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-neutral-100 bg-sidebar p-2 md:flex", expanded ? "w-[260px]" : "w-16")} data-expanded={expanded}>
        <div className={cn("mb-4 flex h-12 items-center", expanded ? "justify-between pl-3" : "justify-center")}>
          {expanded ? <div className="truncate text-heading">{tenantName}</div> : null}
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={expanded ? "Collapse menu" : "Expand menu"}>
            {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </div>
        <NavGroups groups={groups} compact={!expanded} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 flex h-16 items-center gap-2 border-b border-neutral-100 bg-background px-3 md:gap-4 md:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu" />}>
              <Menu />
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl p-4 pb-[env(safe-area-inset-bottom,0px)]">
              <SheetTitle className="text-heading">{tenantName}</SheetTitle>
              <div className="mt-3">
                <NavGroups groups={groups} onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1 truncate text-heading md:hidden">{tenantName}</div>
          <CommandSearch />
          <div className="flex items-center gap-2 md:ml-auto">
            <SyncBadge />
            <BranchSwitcher />
            <Link href="/me" aria-label="My account" className="rounded-full">
              <Avatar name={me} size="sm" />
            </Link>
          </div>
        </header>
        <OfflineBanner />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
