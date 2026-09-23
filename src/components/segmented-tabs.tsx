import Link from "next/link";
import { cn } from "@/lib/utils";

type SegmentedTab = { href: string; label: string; active: boolean };

// Section tabs as one pill control; 48px targets on phones.
export function SegmentedTabs({ items, label }: { items: SegmentedTab[]; label: string }) {
  return (
    <nav aria-label={label} className="mb-5 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-neutral-100 p-1 md:inline-flex">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "flex min-h-12 shrink-0 items-center rounded-lg px-4 text-label md:min-h-10",
            t.active ? "bg-card text-neutral-900 shadow-card" : "text-neutral-700 hover:text-neutral-900",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
