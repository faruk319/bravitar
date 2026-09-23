import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Count } from "@/components/count";

// docs/07 §6: every number links to the list behind it.
export function StatCard({ label, value, icon: Icon, href }: { label: string; value: number | string; icon: LucideIcon; href: string }) {
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-2xl border border-neutral-100 bg-card p-4 shadow-card hover:border-neutral-300 md:p-5">
      <span className="flex items-center justify-between gap-2 text-label text-neutral-700">
        {label}
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent-50 text-accent-600">
          <Icon className="size-5" aria-hidden />
        </span>
      </span>
      <span className="text-display text-neutral-900">
        {typeof value === "number" ? <Count value={value} /> : value}
      </span>
    </Link>
  );
}
