import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// One-colour bars (docs/07 §9), thin, on a lighter track of the same blue.

const width = (fraction: number) => `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;

export function Meter({ fraction, className }: { fraction: number; className?: string }) {
  return (
    <span className={cn("block h-2 overflow-hidden rounded-full bg-accent-50", className)}>
      <span className="block h-full rounded-full bg-accent-600" style={{ width: width(fraction) }} />
    </span>
  );
}

export type BarItem = { key: string; label: string; note?: string; value: ReactNode; fraction: number; href?: string };

// Label and value on one line, the bar under them.
export function BarList({ items }: { items: BarItem[] }) {
  return (
    <ul className="divide-y divide-neutral-100">
      {items.map((b) => (
        <li key={b.key} className="py-2">
          <div className="flex items-baseline justify-between gap-3 text-body">
            <span className="min-w-0 truncate">
              {b.href ? (
                <Link href={b.href} className="hover:underline">
                  {b.label}
                </Link>
              ) : (
                b.label
              )}
              {b.note ? <span className="text-caption text-muted-foreground"> · {b.note}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">{b.value}</span>
          </div>
          <Meter fraction={b.fraction} className="mt-1" />
        </li>
      ))}
    </ul>
  );
}

export type Column = { key: string; tick: string; tip: string; value: number; valueText: string; href?: string };

// A column per day (or month) from one baseline. The tallest carries its value;
// the rest show theirs on hover or focus, and open the list behind them.
export function Columns({ columns, label }: { columns: Column[]; label: string }) {
  const max = Math.max(0, ...columns.map((c) => c.value));
  const peak = max ? columns.findIndex((c) => c.value === max) : -1;
  const n = columns.length;
  const step = n <= 8 ? 1 : n <= 16 ? 2 : Math.ceil(n / 5);
  // Near the edges, labels hug the side they are on so they stay inside the card.
  const edge = (i: number) => (i < n / 4 ? "left-0" : i >= (3 * n) / 4 ? "right-0" : "left-1/2 -translate-x-1/2");
  return (
    <figure aria-label={label}>
      <div className="flex h-44 items-end gap-0.5 border-b border-neutral-100 pt-7">
        {columns.map((c, i) => {
          const bar = (
            <span className="relative mx-auto block w-full max-w-6 rounded-t-[4px] bg-accent-600 group-hover:opacity-75 group-focus-visible:opacity-75" style={{ height: `${(c.value / (max || 1)) * 100}%` }}>
              {i === peak ? <span className={cn("absolute bottom-full mb-1 whitespace-nowrap text-caption font-medium text-neutral-900 group-hover:invisible", edge(i))}>{c.valueText}</span> : null}
              <span role="tooltip" className={cn("pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-caption text-white group-hover:block group-focus-visible:block", edge(i))}>
                {c.tip}
              </span>
            </span>
          );
          return c.href && c.value ? (
            <Link key={c.key} href={c.href} aria-label={c.tip} className="group flex h-full min-w-0 flex-1 items-end outline-none">
              {bar}
            </Link>
          ) : (
            <span key={c.key} className="flex h-full min-w-0 flex-1 items-end">
              {c.value ? bar : null}
            </span>
          );
        })}
      </div>
      <div className="relative h-6 text-caption tabular-nums text-muted-foreground">
        {columns.map((c, i) =>
          i % step === 0 ? (
            <span key={c.key} className="absolute top-1 whitespace-nowrap" style={i < n / 2 ? { left: `${(i / n) * 100}%` } : { right: `${((n - 1 - i) / n) * 100}%` }}>
              {c.tick}
            </span>
          ) : null,
        )}
      </div>
    </figure>
  );
}
