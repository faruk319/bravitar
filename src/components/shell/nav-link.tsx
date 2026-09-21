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

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// One row in the rail, the sheet or the bottom nav. `compact` = icon only.
export function NavLink({ item, compact, onNavigate }: { item: NavItem; compact?: boolean | undefined; onNavigate?: (() => void) | undefined }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
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
        compact && "justify-center px-0",
      )}
    >
      <NavIcon name={item.icon} />
      {compact ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
      {!compact && item.count ? <span className="ml-auto text-label text-muted-foreground tabular-nums">{item.count}</span> : null}
    </Link>
  );
}
