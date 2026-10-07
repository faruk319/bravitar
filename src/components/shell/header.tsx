"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { ChevronRight, CircleHelp, Keyboard, LogOut, Settings, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { SyncBadge } from "@/components/offline/offline-sync";
import { type Crumb, crumbsFor, type NavGroup } from "@/lib/auth/nav";
import { cn } from "@/lib/utils";
import { AcademyMenu } from "./academy-menu";
import { BranchSwitcher } from "./branch-switcher";
import { CommandSearch } from "./command-search";
import { useCrumbLeaf } from "./crumb-leaf";
import { useModKey } from "./mod-key";
import { useNavLabel } from "./nav-link";
import { useSignOut } from "./sign-out";
import { useAcademies, useSession, useTenantName } from "./tenant-provider";

const POPUP = "z-50 min-w-48 rounded-xl border border-neutral-100 bg-card p-1 shadow-card outline-none";
const ITEM = "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-body text-neutral-900 outline-none data-[highlighted]:bg-neutral-50 data-[highlighted]:ring-2 data-[highlighted]:ring-ring";
const ICON_BTN = "flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-ring";

function CrumbText({ crumb, last }: { crumb: Crumb; last: boolean }) {
  const text = useNavLabel(crumb);
  if (last) return <span aria-current="page" className="truncate font-medium text-neutral-900">{text}</span>;
  if (crumb.href) return <Link href={crumb.href} className="rounded-sm text-accent-600 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{text}</Link>;
  return <span>{text}</span>;
}

// Phones show only the current page; the trail needs the width.
function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-label text-muted-foreground">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={i} className={cn("flex min-w-0 items-center gap-1.5", !last && "max-md:hidden")}>
              <CrumbText crumb={c} last={last} />
              {!last ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Shortcuts({ open, onOpenChange, returnTo }: { open: boolean; onOpenChange: (o: boolean) => void; returnTo: React.RefObject<HTMLElement | null> }) {
  const mod = useModKey();
  const rows: [string, string][] = [
    [mod === "⌘" ? "⌘ K" : "Ctrl K", "Search students, open or close"],
    ["Esc", "Close a menu, search or dialog"],
  ];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup finalFocus={returnTo} className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover p-5 text-popover-foreground shadow-lg outline-none transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close aria-label="Close" className={ICON_BTN}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <dl className="mt-3 flex flex-col gap-3">
            {rows.map(([keys, what]) => (
              <div key={keys} className="flex items-center justify-between gap-4">
                <dt className="text-body">{what}</dt>
                <dd><kbd className="rounded border border-neutral-300 px-1.5 py-0.5 text-caption whitespace-nowrap">{keys}</kbd></dd>
              </div>
            ))}
          </dl>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HelpMenu() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Menu.Root>
        <Menu.Trigger ref={trigger} aria-label="Help" className={cn(ICON_BTN, "max-md:hidden")}>
          <CircleHelp className="size-5" aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={6} className="z-50">
            <Menu.Popup className={POPUP}>
              <Menu.Item className={ITEM} onClick={() => setOpen(true)}>
                <Keyboard className="size-4" aria-hidden /> Keyboard shortcuts
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Shortcuts open={open} onOpenChange={setOpen} returnTo={trigger} />
    </>
  );
}

function AccountMenu() {
  const me = useSession().actor.name;
  const { busy, msg, signOut } = useSignOut();
  return (
    <Menu.Root>
      <Menu.Trigger aria-label="Account menu" className={cn(ICON_BTN, "p-0")}>
        <Avatar name={me} size="sm" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-50">
          <Menu.Popup className={POPUP}>
            <div className="truncate px-3 py-2 text-label text-muted-foreground">{me}</div>
            <Menu.Item className={ITEM} render={<Link href="/me" />}>
              <User className="size-4" aria-hidden /> Profile
            </Menu.Item>
            <Menu.Item className={ITEM} render={<Link href="/settings" />}>
              <Settings className="size-4" aria-hidden /> Settings
            </Menu.Item>
            <Menu.Item className={ITEM} disabled={busy} closeOnClick={false} onClick={signOut}>
              <LogOut className="size-4" aria-hidden /> Log out
            </Menu.Item>
            {msg ? <p role="alert" className="px-3 py-2 text-label text-danger-700">{msg}</p> : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// `groups` is what this person may see, so the trail never names a hidden page.
export function Header({ groups, menu }: { groups: NavGroup[]; menu: ReactNode }) {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname, useCrumbLeaf(), groups);
  const tenantName = useTenantName();
  const academies = useAcademies();
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 flex h-16 items-center gap-2 border-b border-neutral-100 bg-background px-3 md:gap-4 md:px-6 print:hidden">
      {menu}
      <div className="flex min-w-0 flex-1 items-center">
        {crumbs.length ? <Breadcrumbs crumbs={crumbs} /> : <div className="truncate text-heading md:hidden">{tenantName}</div>}
      </div>
      <CommandSearch />
      <div className="flex items-center gap-1 md:flex-1 md:justify-end md:gap-2">
        <SyncBadge />
        <HelpMenu />
        <AcademyMenu academies={academies} action="/switch" />
        <BranchSwitcher />
        <AccountMenu />
      </div>
    </header>
  );
}
