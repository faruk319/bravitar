"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLabel } from "@/components/shell/tenant-provider";
import { cn } from "@/lib/utils";

export function BatchTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/batches", label: useLabel("batch", "many") },
    { href: "/batches/calendar", label: "Week" },
    { href: "/batches/programs", label: useLabel("program", "many") },
    { href: "/batches/holidays", label: "Holidays" },
  ];
  const active = tabs.findLast((t) => pathname === t.href || (t.href !== "/batches" && pathname.startsWith(t.href)))?.href ?? "/batches";
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? "page" : undefined}
          className={cn("min-h-12 shrink-0 border-b-2 px-3 pt-3 text-body", t.href === active ? "border-accent-600 font-medium text-accent-600" : "border-transparent text-neutral-700")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
