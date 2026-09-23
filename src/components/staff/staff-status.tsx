import { cn } from "@/lib/utils";
import type { StaffStatus } from "@/modules/staff/service";

const SHOW: Record<StaffStatus, { word: string; cls: string }> = {
  active: { word: "● Active", cls: "bg-success-600/10 text-success-600" },
  invited: { word: "✉ Invite sent", cls: "bg-accent-50 text-accent-600" },
  "needs-link": { word: "◐ Needs a link", cls: "bg-warning-600/10 text-warning-600" },
  off: { word: "○ Off", cls: "bg-neutral-100 text-neutral-500" },
};

export function StaffStatusPill({ status }: { status: StaffStatus }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-label", SHOW[status].cls)}>{SHOW[status].word}</span>;
}
