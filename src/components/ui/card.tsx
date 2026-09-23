import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// docs/07 §6: a white card on the canvas.
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-2xl border border-neutral-100 bg-card p-4 shadow-card md:p-5", className)} {...props} />;
}

// Title on the left, at most one control on the right.
export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex min-h-10 flex-wrap items-center justify-between gap-3", className)}>
      <h2 className="text-heading">{title}</h2>
      {action}
    </div>
  );
}
