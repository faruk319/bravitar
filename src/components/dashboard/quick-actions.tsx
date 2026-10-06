import { CalendarCheck, IndianRupee, type LucideIcon, Megaphone, Plus, UsersRound } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const ACTIONS = {
  addStudent: { label: "Add student", href: "/students/new", icon: Plus },
  createBatch: { label: "Create batch", href: "/batches/new", icon: UsersRound },
  markAttendance: { label: "Mark attendance", href: "/attendance", icon: CalendarCheck },
  collectPayment: { label: "Collect payment", href: "/payments/new", icon: IndianRupee },
  sendAnnouncement: { label: "Send announcement", href: "/messages", icon: Megaphone },
} satisfies Record<string, { label: string; href: string; icon: LucideIcon }>;

export type QuickAction = keyof typeof ACTIONS;

// The page decides which actions the viewer may use and passes only those.
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (!actions.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
