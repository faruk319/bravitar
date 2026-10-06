import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Alert = { key: string; n: number; text: string; href: string; icon: LucideIcon; tone: "warning" | "danger" | "muted" };

export function AttentionRequired({ alerts }: { alerts: Alert[] }) {
  const shown = alerts.filter((a) => a.n > 0);
  if (!shown.length) return null; // nothing to attend to is not an empty card
  return (
    <Card>
      <CardHeader title="Attention required" />
      <ul className="divide-y divide-neutral-100">
        {shown.map((a) => {
          const Icon = a.icon;
          return (
            <li key={a.key}>
              <Link href={a.href} className="flex min-h-12 items-center gap-3 py-2 text-body hover:bg-neutral-50">
                <Icon className={cn("size-5 shrink-0", a.tone === "danger" && "text-danger-700", a.tone === "warning" && "text-warning-700", a.tone === "muted" && "text-muted-foreground")} aria-hidden />
                <span className="min-w-0">{a.text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
