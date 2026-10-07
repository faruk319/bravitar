import { CalendarCheck, type LucideIcon, Megaphone, UsersRound } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const ACTIONS = {
  createBatch: { label: "Create batch", href: "/batches/new", icon: UsersRound },
  markAttendance: { label: "Mark attendance", href: "/attendance", icon: CalendarCheck },
  sendAnnouncement: { label: "Send announcement", href: "/messages", icon: Megaphone },
} satisfies Record<string, { label: string; href: string; icon: LucideIcon }>;

export type QuickAction = keyof typeof ACTIONS;

// The page decides which actions the viewer may use and passes only those.
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (!actions.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {actions.map((key) => {
        const { label, href, icon: Icon } = ACTIONS[key];
        return (
          <Button key={key} nativeButton={false} render={<Link href={href} />} variant="outline" className="h-auto min-h-11 justify-start whitespace-normal py-2">
            <Icon aria-hidden />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
