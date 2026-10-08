"use client";

import * as icons from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, type NavItem } from "@/lib/auth/nav";
import { cn } from "@/lib/utils";
import { useLabel } from "./tenant-provider";

export function useNavLabel(item: Pick<NavItem, "label">): string {
  const label = item.label;
  const word = useLabel("labelKey" in label ? label.labelKey : "student", "labelKey" in label ? label.form : "one");
  if ("text" in label) return label.text;
  return `${label.prefix ?? ""}${word}`;
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (icons as unknown as Record<string, icons.LucideIcon>)[name] ?? icons.Circle;
  return <Icon className={cn("size-6 shrink-0", className)} aria-hidden />;
}

export { isActive } from "@/lib/auth/nav";

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
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-lg px-3 text-body whitespace-nowrap text-neutral-700 outline-none hover:bg-neutral-0/70 focus-visible:ring-2 focus-visible:ring-ring",
        // Active is a white card raised off the grey rail, not a coloured slab;
        // the icon alone carries the accent. Never colour alone: aria-current + weight.
        active && "bg-neutral-0 text-neutral-900 font-medium shadow-[0_1px_3px_rgba(17,24,39,0.08),0_1px_2px_rgba(17,24,39,0.04)]",
        compact && "justify-center px-0",
      )}
    >
      <NavIcon name={item.icon} {...(active ? { className: "text-accent-600" } : {})} />
      <span className={compact ? "sr-only" : "truncate"}>{label}</span>
      {!compact && item.count ? <span className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-700 tabular-nums">{item.count}</span> : null}
    </Link>
  );
}
