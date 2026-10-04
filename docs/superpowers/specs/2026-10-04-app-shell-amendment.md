# App shell — amendment to the dashboard redesign spec

Date: 2026-10-04
Amends: `docs/superpowers/specs/2026-10-03-admin-dashboard-redesign-design.md` §2
Status: approved (decisions below taken by the user 2026-10-04)

The user supplied a full global-shell brief (hover sidebar, header, footer,
responsive). It replaces §2 of the original spec, which covered only a
restyled rail. Tasks 7-9 of the plan are superseded by the tasks here.

## Decisions taken

1. **Hover on desktop, tap on touch.** The sidebar expands on hover as an
   **overlay** on pointer-capable screens, with a **pin** that persists the
   expanded state. Touch and tablet keep tap-to-open — hover does not exist
   there, and `docs/07` locks phone-first for staff. Gate on
   `@media (hover: hover) and (pointer: fine)`, not on width.
2. **No Notifications.** There is no notifications module — no table, no
   service, no data. No nav item and no header bell until one exists. The
   user's own brief says not to present absent backend functionality as real.
3. **Finance is student money only.** `/billing` is the academy's own
   subscription to Bravitar, not student finance, and must not sit beside
   Invoices and Collections. It moves to ACADEMY, next to Settings.
4. **Breadcrumbs are route-derived in the global header.** `PageHeader` stops
   rendering its own; the header computes them from the URL plus the nav
   config, with a per-page override for entity names the URL cannot supply
   ("Aarav Sharma", "Invoice INV-2026-001").

## Navigation

Every destination that exists today is kept and stays permission-filtered
through the existing `navFor()`. Nothing is invented.

```
MAIN
  Dashboard            /dashboard
  Today's classes      /today
  Attendance           /attendance
  Students             /students
  Enquiries            /enquiries
  Courses & Programs   /batches/programs
  Batches              /batches
  Finance ▾            (parent, no route of its own)
    Invoices           /invoices
    Collections        /payments
    Collect payment    /payments/new
    Fee plans          /fee-plans
  Reports              /reports

ACADEMY
  Staff                /staff
  Messages             /messages
  Settings             /settings
  Billing              /billing
```

Dropped from the user's list, with reasons: **Overview** (no route),
**Subscriptions** (is `/billing`, moved to ACADEMY per decision 3),
**Discounts & Credits** (a component inside fee plans, not a route),
**Notifications** (decision 2). **Reports** appears once, in MAIN — not
duplicated under Finance.

## Shell structure

```
AppShell
├── Sidebar      fixed; collapsed 72px, expanded 248px as an overlay
├── Main
│   ├── Header   sticky, 64px
│   └── Content  independently scrollable
└── Footer       in content flow, not fixed
```

**The main content must not resize when the sidebar expands.** The collapsed
rail reserves its 72px permanently; the expanded panel is absolutely
positioned above the content with a z-index over it. Content width never
changes, so no reflow and no layout shift.

Hover intent needs a small enter/leave delay so that crossing the rail does
not trigger expansion, and so moving between child items never re-triggers
the animation. Expansion is 180–220ms; dropdowns 120–160ms. All of it is
suppressed under `prefers-reduced-motion: reduce`.

## Header

Left: route-derived breadcrumbs, omitted on `/dashboard`. Centre: the
existing `CommandSearch`, with the ⌘K / Ctrl K hint picked from the platform.
Right: Help, academy switcher, branch switcher, avatar with a dropdown
(Profile → `/me`, Settings → `/settings`, Logout via the existing sign-out).

Help is a dropdown with Keyboard shortcuts (real, a local dialog) and nothing
else, since no help centre or support system exists. No invented links.

## Footer

Quiet, in content flow. Left `© 2026 Bravitar`. Right: the app version, and
only links that resolve. No Privacy, Terms or System Status until those pages
exist.

## Mobile

No hover anywhere. Hamburger opens a full-height drawer over a scrim; it
closes on outside click, on Escape, and after navigation. Header stays
compact: `[☰] [title] [search] [avatar]`. Touch targets ≥44px.

## Accessibility

Keyboard-navigable sidebar; visible focus throughout; `aria-label` on every
icon-only control; tooltips **only** when collapsed, never when expanded;
`aria-current="page"` on the active item; `aria-expanded` on the Finance
disclosure; Escape closes drawer and dropdowns; the expanded overlay must not
trap focus.

## Non-goals

Notifications. A help centre. Privacy/Terms/Status pages. Restyling any
module's own screens. A second auth system.

## Tasks (supersede plan Tasks 7-9)

- **S1** Nav config: MAIN/ACADEMY, the Finance parent, route-derived
  breadcrumb helper. Pure data + unit tests, no UI.
- **S2** Sidebar: hover overlay, pin, persistence, tooltips, nested
  disclosure, mobile drawer.
- **S3** Header: breadcrumbs, search, help, switchers, avatar dropdown.
- **S4** Footer, plus removing breadcrumbs from `PageHeader` and the 16
  pages that pass `crumbs=` (measured, not estimated).
- **S5** Responsive, reduced-motion and accessibility pass, verified in
  Chrome at desktop, tablet and 390px.
