"use client";

import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FocusEvent, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/avatar";
import { OfflineBanner } from "@/components/offline/offline-sync";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { isActive, isParent, type NavEntry, type NavGroup, type NavItem, type NavParent } from "@/lib/auth/nav";
import { cn } from "@/lib/utils";
import { CrumbLeafProvider } from "./crumb-leaf";
import { Footer } from "./footer";
import { Header } from "./header";
import { NavIcon, NavLink, useNavLabel } from "./nav-link";
import { useSession, useTenantName } from "./tenant-provider";

const RAIL_KEY = "bravitar.rail";
const RAIL_EVENT = "bravitar:rail";
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
const ENTER_MS = 120;
const LEAVE_MS = 200;

// No hover (touch, tablets) means no way to peek; the server assumes hover so
// it renders collapsed, and a touch client flips after hydration.
function useCanHover(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(HOVER_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(HOVER_QUERY).matches,
    () => true,
  );
}

// The saved choice (null = none yet), per browser; the server renders collapsed.
function useRailChoice(): [boolean | null, (open: boolean) => void] {
  const raw = useSyncExternalStore(
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
        return localStorage.getItem(RAIL_KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const save = (open: boolean) => {
    try {
      localStorage.setItem(RAIL_KEY, open ? "open" : "closed");
    } catch {}
    window.dispatchEvent(new Event(RAIL_EVENT));
  };
  return [raw === null ? null : raw === "open", save];
}

// Parents seed open on their own route, then stay as the person left them.
function Disclosure({ parent, compact, onNavigate, others }: { parent: NavParent; compact?: boolean | undefined; onNavigate?: (() => void) | undefined; others: string[] }) {
  const pathname = usePathname();
  const label = useNavLabel({ label: parent.title });
  const [open, setOpen] = useState(() => parent.children.some((c) => isActive(pathname, c.href, others)));
  const panelId = useId();
  const links = parent.children.map((c) => <NavLink key={c.href} item={c} compact={compact} onNavigate={onNavigate} others={others} />);
  // One tree for both rail widths. Collapsed hides the button and shows the
  // children flat (no room for a popover). Hiding is CSS-only and never applies
  // to an element holding focus, so a focus-driven resize cannot drop focus.
  // Button :focus, panel :focus-within (a child may hold it); a clicked button stays visible until focus moves. Don't simplify to !open.
  return (
    <div className={cn(compact && "border-y border-neutral-100 py-1")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className={cn("flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-body whitespace-nowrap text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-ring", compact && "[&:not(:focus)]:hidden")}
      >
        <NavIcon name={parent.icon} />
        <span className="truncate">{label}</span>
        <ChevronDown className={cn("ml-auto size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      <div id={panelId} className={cn("flex flex-col gap-0.5", !compact && "ml-6 border-l border-neutral-100 pl-2", !compact && !open && "[&:not(:focus-within)]:hidden")}>
        {links}
      </div>
    </div>
  );
}

function NavGroups({ groups, compact, onNavigate }: { groups: NavGroup[]; compact?: boolean; onNavigate?: () => void }) {
  const leaves = (e: NavEntry): NavItem[] => (isParent(e) ? e.children : [e]);
  const hrefs = groups.flatMap((g) => g.items.flatMap((e) => leaves(e).map((i) => i.href)));
  return (
    <nav className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.title}>
          {!compact ? <div className="px-3 pb-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">{g.title}</div> : null}
          <div className="flex flex-col gap-0.5">
            {g.items.map((item) =>
              isParent(item) ? (
                <Disclosure key={item.icon + g.title} parent={item} compact={compact} onNavigate={onNavigate} others={hrefs} />
              ) : (
                <NavLink key={item.href} item={item} compact={compact} onNavigate={onNavigate} others={hrefs} />
              ),
            )}
          </div>
        </div>
      ))}
    </nav>
  );
}

// The desktop rail: hover expansion overlays the page; pinning widens the
// column so content makes room.
function Rail({ groups }: { groups: NavGroup[] }) {
  const tenantName = useTenantName();
  const me = useSession().actor.name;
  const canHover = useCanHover();
  const [choice, save] = useRailChoice();
  // A saved choice wins; without one, touch starts expanded.
  const pinned = choice ?? !canHover;
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = pinned || hovered;
  const schedule = (next: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(next), ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if (!e.target.matches(":focus-visible")) return;
    clearTimeout(timer.current);
    setHovered(true);
  };
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) schedule(false, LEAVE_MS);
  };

  const pinButton = (
    <Button variant="ghost" size="icon-sm" onClick={() => save(!pinned)} aria-label={pinned ? "Unpin menu" : "Pin menu"} aria-pressed={pinned}>
      {pinned ? <PanelLeftClose /> : <PanelLeftOpen />}
    </Button>
  );
  const profile = (
    <Link href="/me" className={cn("flex min-h-12 items-center gap-3 rounded-lg px-2 whitespace-nowrap outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-ring", !open && "justify-center px-0")}>
      <Avatar name={me} size="sm" />
      {open ? (
        <span className="min-w-0">
          <span className="block truncate text-label">{me}</span>
          <span className="block truncate text-caption text-muted-foreground">{tenantName}</span>
        </span>
      ) : (
        <span className="sr-only">{`${me}, ${tenantName}`}</span>
      )}
    </Link>
  );

  return (
    <div className={cn("sticky top-0 z-30 hidden h-screen shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none md:block print:hidden", pinned ? "w-[248px]" : "w-[72px]")}>
      <aside
        data-expanded={open}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse" && window.matchMedia(HOVER_QUERY).matches) schedule(true, ENTER_MS);
        }}
        onPointerLeave={() => schedule(false, LEAVE_MS)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            clearTimeout(timer.current);
            setHovered(false);
          }
        }}
        className={cn(
          "absolute inset-y-0 left-0 flex flex-col border-r border-neutral-100 bg-sidebar p-2 transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none",
          open ? "w-[248px]" : "w-[72px]", open && !pinned && "shadow-lg",
        )}
      >
        <div className={cn("mb-4 flex h-12 shrink-0 items-center", open ? "justify-between pl-3" : "justify-center")}>
          {open ? <div className="truncate text-heading">{tenantName}</div> : null}
          {pinButton}
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <NavGroups groups={groups} compact={!open} />
        </div>
        <div className="mt-2 shrink-0 border-t border-neutral-100 pt-2">
          {profile}
        </div>
      </aside>
    </div>
  );
}

// The app-shell amendment: a hover overlay rail on desktop, a left drawer
// on touch and phones.
export function AdminShell({ groups, children }: { groups: NavGroup[]; children: ReactNode }) {
  const tenantName = useTenantName();
  const [open, setOpen] = useState(false);

  return (
    <CrumbLeafProvider>
      <div className="flex min-h-full">
        <Rail groups={groups} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            groups={groups}
            menu={
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu" />}>
                  <Menu />
                </SheetTrigger>
                <SheetContent side="left" className="overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                  <SheetTitle className="text-heading">{tenantName}</SheetTitle>
                  <div className="mt-3">
                    <NavGroups groups={groups} onNavigate={() => setOpen(false)} />
                  </div>
                </SheetContent>
              </Sheet>
            }
          />
          <div className="print:hidden">
            <OfflineBanner />
          </div>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8 print:p-0">{children}</main>
          <Footer />
        </div>
      </div>
    </CrumbLeafProvider>
  );
}
