import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// docs/07 §3: every list row is 56px and tappable across its full width.
type RowProps = { href?: string; onClick?: () => void; className?: string; children: ReactNode; trailing?: ReactNode };

export function Row({ href, onClick, className, children, trailing }: RowProps) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? <div className="ml-3 shrink-0">{trailing}</div> : null}
    </>
  );
  const base = cn("flex min-h-14 w-full items-center border-b border-border px-4 text-left text-body hover:bg-neutral-50 active:bg-neutral-100", className);
  if (href) {
    return (
      <Link href={href} className={base}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base}>
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}
