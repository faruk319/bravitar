"use client";

import * as icons from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/auth/nav";
import { cn } from "@/lib/utils";
import { useLabel } from "./tenant-provider";

export function useNavLabel(item: NavItem): string {
  const label = item.label;
  const word = useLabel("labelKey" in label ? label.labelKey : "student", "labelKey" in label ? label.form : "one");
  if ("text" in label) return label.text;
  return `${label.prefix ?? ""}${word}`;
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (icons as unknown as Record<string, icons.LucideIcon>)[name] ?? icons.Circle;
  return <Icon className={cn("size-6 shrink-0", className)} aria-hidden />;
}

// The item for this page, or a parent of it; a more specific item wins
// (/payments/new is Collect payment, not Collection).
export function isActive(pathname: string, href: string, others: string[] = []): boolean {
  const under = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  return under(href) && !others.some((h) => h.length > href.length && under(h));
}

// One row in the rail, the sheet or the bottom nav. `compact` = icon only.
export function NavLink({ item, compact, onNavigate, others }: { item: NavItem; compact?: boolean | undefined; onNavigate?: (() => void) | undefined; others?: string[] }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href, others);
  const label = useNavLabel(item);
  return (
    <Link
      href={item.href}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      {...(active ? { "aria-current": "page" as const } : {})}
      {...(compact ? { title: label } : {})}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-lg px-3 text-body text-neutral-700 hover:bg-neutral-50",
        active && "bg-accent text-accent-foreground font-medium",
        active && !compact && "relative before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent-600",
        compact && "justify-center px-0",
      )}
    >
      <NavIcon name={item.icon} />
      {compact ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
      {!compact && item.count ? <span className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-700 tabular-nums">{item.count}</span> : null}
    </Link>
  );
}
