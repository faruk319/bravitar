import type { LabelKey } from "@/lib/tenant/labels";
import { can } from "./can";
import { PERMISSIONS, type PermissionKey } from "./permissions";

// Navigation is data, filtered with the same can() the server uses, so what
// is hidden is exactly what is refused. Order follows docs/07 §4.
export type NavLabel = { text: string } | { labelKey: LabelKey; form: "one" | "many"; prefix?: string };

export type NavItem = {
  href: string;
  label: NavLabel;
  icon: string; // lucide icon name, resolved in the component
  permission: PermissionKey | null;
  count?: number;
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Daily",
    items: [
      { href: "/dashboard", label: { text: "Dashboard" }, icon: "LayoutDashboard", permission: null }, // blocks inside follow permissions
      { href: "/today", label: { labelKey: "session", form: "many", prefix: "Today's " }, icon: "CalendarDays", permission: "sessions:read" },
      { href: "/attendance", label: { text: "Attendance" }, icon: "ClipboardCheck", permission: "attendance:read" },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/students", label: { labelKey: "student", form: "many" }, icon: "Users", permission: "students:read" },
      { href: "/enquiries", label: { text: "Enquiries" }, icon: "MessageSquare", permission: "enquiries:read" },
      { href: "/staff", label: { labelKey: "staff", form: "many" }, icon: "UserCog", permission: "staff:read" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/invoices", label: { text: "Invoices" }, icon: "Receipt", permission: "invoices:read" },
      { href: "/payments/new", label: { text: "Collect payment" }, icon: "IndianRupee", permission: "fees:collect" },
      { href: "/reports", label: { text: "Reports" }, icon: "BarChart3", permission: "reports:view" },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/batches", label: { labelKey: "batch", form: "many", prefix: "Programs & " }, icon: "Layers", permission: "batches:read" },
      { href: "/fee-plans", label: { text: "Fee plans" }, icon: "FileText", permission: "fee_plans:manage" },
      { href: "/messages", label: { text: "Messages" }, icon: "Send", permission: "messages:read" },
      { href: "/settings", label: { text: "Settings" }, icon: "Settings", permission: "settings:manage" },
    ],
  },
];

export const COACH_NAV: NavItem[] = [
  { href: "/today", label: { text: "Today" }, icon: "CalendarDays", permission: "sessions:read" },
  { href: "/students", label: { labelKey: "student", form: "many" }, icon: "Users", permission: "students:read" },
  { href: "/me", label: { text: "Me" }, icon: "CircleUser", permission: null },
];

export type NavSession = { isOwner: boolean; modules: Record<string, boolean>; permissions: string[] };

export function allowed(session: NavSession, item: NavItem): boolean {
  if (!item.permission) return true;
  return can({ tenantId: "", staffId: "", ...session }, PERMISSIONS[item.permission].module, item.permission);
}

export function navFor(session: NavSession, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => allowed(session, i)) })).filter((g) => g.items.length > 0);
}

export function coachNavFor(session: NavSession): NavItem[] {
  return COACH_NAV.filter((i) => allowed(session, i));
}
