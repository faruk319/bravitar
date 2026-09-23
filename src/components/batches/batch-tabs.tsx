"use client";

import { usePathname } from "next/navigation";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { useLabel } from "@/components/shell/tenant-provider";

export function BatchTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/batches", label: useLabel("batch", "many") },
    { href: "/batches/calendar", label: "Week" },
    { href: "/batches/programs", label: useLabel("program", "many") },
    { href: "/batches/holidays", label: "Holidays" },
  ];
  const active = tabs.findLast((t) => pathname === t.href || (t.href !== "/batches" && pathname.startsWith(t.href)))?.href ?? "/batches";
  return <SegmentedTabs label="Sections" items={tabs.map((t) => ({ ...t, active: t.href === active }))} />;
}
