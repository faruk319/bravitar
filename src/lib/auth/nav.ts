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
  permission: PermissionKey | PermissionKey[] | null; // a list = any of them
  count?: number;
};

// A parent is a disclosure with no route of its own.
export type NavParent = { title: NavLabel; icon: string; children: NavItem[] };
export type NavEntry = NavItem | NavParent;
export type NavGroup = { title: string; items: NavEntry[] };

export function isParent(entry: NavEntry): entry is NavParent {
  return "children" in entry;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Main",
    items: [
      { href: "/dashboard", label: { text: "Dashboard" }, icon: "LayoutDashboard", permission: null }, // blocks inside follow permissions
      { href: "/today", label: { labelKey: "session", form: "many", prefix: "Today's " }, icon: "CalendarDays", permission: "sessions:read" },
      { href: "/attendance", label: { text: "Attendance" }, icon: "ClipboardCheck", permission: "attendance:read" },
      { href: "/students", label: { labelKey: "student", form: "many" }, icon: "Users", permission: "students:read" },
      { href: "/enquiries", label: { text: "Enquiries" }, icon: "MessageSquare", permission: "enquiries:read" },
      // One entry: /batches and /batches/programs are the same surface, switched by BatchTabs.
      { href: "/batches", label: { labelKey: "batch", form: "many" }, icon: "Layers", permission: "batches:read" },
      {
        title: { text: "Finance" },
        icon: "Landmark",
        children: [
          { href: "/finance", label: { text: "Overview" }, icon: "LayoutGrid", permission: ["invoices:read", "payments:read"] }, // blocks inside follow permissions
          // Front Desk collects without payments:read; the page shows them their own receipts.
          { href: "/finance/collections", label: { text: "Collections" }, icon: "Wallet", permission: ["payments:read", "fees:collect"] },
          { href: "/finance/invoices", label: { text: "Invoices" }, icon: "Receipt", permission: "invoices:read" },
          { href: "/finance/student-plans", label: { text: "Student plans" }, icon: "Repeat", permission: "invoices:read" },
          { href: "/finance/fee-plans", label: { text: "Fee plans" }, icon: "FileText", permission: "fee_plans:manage" },
          { href: "/finance/discounts", label: { text: "Discounts & credits" }, icon: "BadgePercent", permission: "invoices:read" },
          { href: "/finance/reports", label: { text: "Reports" }, icon: "BarChart3", permission: "reports:view" },
        ],
      },
      { href: "/reports", label: { text: "Reports" }, icon: "BarChart3", permission: "reports:view" },
    ],
  },
  {
    title: "Academy",
    items: [
      { href: "/staff", label: { labelKey: "staff", form: "many" }, icon: "UserCog", permission: "staff:read" },
      { href: "/messages", label: { text: "Messages" }, icon: "Send", permission: "messages:read" },
      { href: "/settings", label: { text: "Settings" }, icon: "Settings", permission: "settings:manage" },
      { href: "/billing", label: { text: "Billing" }, icon: "CreditCard", permission: "billing:view" },
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
  const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
  return keys.some((key) => can({ tenantId: "", staffId: "", ...session }, PERMISSIONS[key].module, key));
}

// A parent with no permitted child vanishes; with one, it becomes that link.
function visible(session: NavSession, entry: NavEntry): NavEntry | null {
  if (!isParent(entry)) return allowed(session, entry) ? entry : null;
  const children = entry.children.filter((c) => allowed(session, c));
  if (children.length === 0) return null;
  const [only] = children;
  return children.length === 1 && only ? only : { ...entry, children };
}

export function navFor(session: NavSession, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.flatMap((e) => visible(session, e) ?? []) }))
    .filter((g) => g.items.length > 0);
}

// The item for this page, or a parent of it; a more specific item wins.
export function isActive(pathname: string, href: string, others: string[] = []): boolean {
  const under = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  return under(href) && !others.some((h) => h.length > href.length && under(h));
}

// href null = not a link (the Finance parent, or the page you are on).
export type Crumb = { label: NavLabel; href: string | null };

// Static subroutes that are not nav items but have a fixed name.
const STATIC_TITLES: Record<string, NavLabel> = {
  "/batches/calendar": { text: "Calendar" },
  "/batches/programs": { labelKey: "program", form: "many" },
  "/batches/holidays": { text: "Holidays" },
  "/batches/new": { labelKey: "batch", form: "one", prefix: "Add " },
  "/students/new": { labelKey: "student", form: "one", prefix: "Add " },
  "/students/import": { labelKey: "student", form: "many", prefix: "Import " },
  "/staff/roles": { text: "Roles" },
  "/reports/attendance": { text: "Attendance summary" },
  "/finance/reports/collection": { text: "Collection register" },
  "/finance/reports/dues": { text: "Outstanding dues" },
  "/finance/reports/revenue": { text: "Revenue" },
  "/reports/admissions": { text: "Admissions and dropouts" },
  "/reports/at-risk": { text: "At risk" },
};

// Crumbs for a pathname from the config. `leaf` names the entity under the
// matched item ("Aarav Sharma"); until the page supplies it, the trail stops
// one level up rather than showing a placeholder.
export function crumbsFor(pathname: string, leaf?: string, groups: NavGroup[] = NAV_GROUPS): Crumb[] {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return [];
  const flat = groups.flatMap((g) => g.items.flatMap((e): { item: NavItem; parent: NavParent | null }[] => (isParent(e) ? e.children.map((item) => ({ item, parent: e })) : [{ item: e, parent: null }])));
  const hrefs = flat.map((f) => f.item.href);
  const hit = flat.find((f) => isActive(pathname, f.item.href, hrefs));
  if (!hit) return [];
  const under = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  const named = Object.keys(STATIC_TITLES)
    .filter((k) => k.length > hit.item.href.length && under(k))
    .sort((a, b) => b.length - a.length)[0];
  const end = named ?? hit.item.href;
  const trail: Crumb[] = [];
  if (hit.parent) trail.push({ label: hit.parent.title, href: null });
  trail.push({ label: hit.item.label, href: pathname !== hit.item.href ? hit.item.href : null });
  if (named) trail.push({ label: STATIC_TITLES[named] as NavLabel, href: pathname !== named ? named : null });
  if (pathname !== end && leaf) trail.push({ label: { text: leaf }, href: null });
  return trail;
}

export function coachNavFor(session: NavSession): NavItem[] {
  return COACH_NAV.filter((i) => allowed(session, i));
}
