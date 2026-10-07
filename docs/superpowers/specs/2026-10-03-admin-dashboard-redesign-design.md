# Admin dashboard redesign — design

Date: 2026-10-03
Status: approved (design); implementation plan not yet written

## Intent

Move Bravitar's admin surface to a premium, minimal SaaS look — the register
Linear and Stripe use — starting with the design tokens, the admin shell and
the `/dashboard` page. Every other page inherits the token and shell change for
free; their own polish passes come later.

Success: an owner opening `/dashboard` on a laptop sees a dashboard that reads
as a commercial product, and the same page on a 390px phone is still the tool a
coach can use standing in a hall. No existing route, query or permission check
behaves differently afterwards.

Reference images: `docs/uiux reference.webp`, `docs/sidebar.webp`.

## Decisions taken (2026-10-03)

These were settled in conversation and are not open in implementation.

1. **Scope.** Tokens + admin shell + `/dashboard` now. Other pages inherit the
   tokens; they are not individually restyled in this slice.
2. **One accent colour.** The per-academy-type accents agreed 2026-09-26
   (deeniyat turquoise, karate maroon, dance violet, sports sky) are
   **dropped**. Every academy gets `#2563EB`. This reverses that decision
   deliberately; `docs/07-ui-ux.md` §2 is rewritten to match in this slice.
3. **Real data only.** No mock data anywhere. Sections the DB cannot answer
   today get their query added in this slice.
4. **Nav keeps every real destination**, reorganised into MAIN / MANAGEMENT.
   No invented items — there is no Referrals or Notifications module and none
   is stubbed.
5. **Recharts** is adopted now for the two charts, reversing the "CSS bars
   until after launch" decision.
6. **At risk and Pipeline survive.** At risk folds into Attention Required;
   Pipeline keeps its own card.

## Non-goals

- Restyling the coach shell, parent portal or platform area.
- Any change to auth, RLS, the `app_runtime` role, migrations or schema.
- A widget registry or "Add widget" picker (present in the reference image,
  not requested — YAGNI).
- Dark mode.

## 1 — Design tokens

`src/app/globals.css`. Repoint the existing token names in place; do not rename
them. Every page already consumes them, so the whole app moves at once.

| Token | From | To |
|---|---|---|
| `--color-neutral-50` | `#F7F7F6` | `#F7F8FA` |
| `--color-neutral-100` | `#EDEDEA` | `#F3F4F6` |
| `--color-neutral-300` | `#C9C9C4` | `#E5E7EB` |
| `--color-neutral-500` | `#77776F` | `#6B7280` |
| `--color-neutral-700` | `#464642` | `#374151` |
| `--color-neutral-900` | `#1A1A18` | `#111827` |
| `--color-accent-600` | `#2B5FD9` | `#2563EB` |
| `--color-accent-50` | `#EEF3FD` | `#EFF6FF` |

Radius: controls `10px`, cards `12px`. Replace the current 8/12/16 ladder.
Shadow stays one faint lift plus a 1px border; no second shadow layer.

### Status colours split fill from text

The spec's `#F59E0B` is 2.1:1 on white and `#EF4444` is 3.8:1 — both fail WCAG
AA for text. Each status therefore gets two tokens: the bright one for dots,
bars and fills, a darker paired one for text.

```
--color-success-600 #16A34A   --color-success-700 #15803D
--color-warning-600 #F59E0B   --color-warning-700 #B45309
--color-danger-600  #EF4444   --color-danger-700  #B91C1C
```

Rule unchanged from `docs/07` §2: status never appears on buttons or
navigation, and never carries meaning alone — an icon or a word goes with it.

### Removing the per-type accent

Delete the four `[data-vertical="…"]` blocks. `data-vertical` then has no
remaining consumer (verified: `grep -rn "data-vertical" src docs` matches only
`globals.css`, `layout.tsx:31` and the old `docs/07` paragraph, now rewritten), so
also remove the attribute and the `resolveTenantBySlug()` lookup at
`src/app/layout.tsx:28-30`. That lookup is a database query on **every page
render** whose only purpose was picking the accent; dropping it is a free
latency win on all three shells.

### Typography

Body moves to 14px (`--text-body: 0.875rem`). Display 24px/600 and heading
18px/600 are already correct. Body and label then share 14px and differ only in
weight (400 vs 500); caption stays 13px. That is intended.

**Constraint:** form inputs keep a **16px** font size on viewports under `md`,
or iOS Safari zooms the page on focus. Since `--text-body` is now 14px, this
needs an explicit 16px on mobile — `text-[1rem] md:text-body` in
`src/components/ui/input.tsx`, not in each call site.

## 2 — Admin shell

`src/components/shell/admin-shell.tsx`, `src/lib/auth/nav.ts`,
`src/components/shell/nav-link.tsx`.

Groups become two. Every destination that exists today is kept, and
`navFor()`'s permission filtering is untouched.

```
MAIN         Dashboard · Today's sessions · Attendance · Students · Staff ·
             Programs & batches · Fees & Payments ▾ · Reports
MANAGEMENT   Enquiries · Fee plans · Messages · Settings · Billing
```

`Fees & Payments` is a new collapsible parent over the three existing money
routes (Invoices, Collect payment, Collection). This is the one piece of new
nav behaviour: `NavLink` gains a nested variant that expands when the current
path is inside it, and is expanded by default when any child is active. A
parent with exactly one permitted child after filtering renders as a plain link
to that child, not as a group of one.

Visual treatment, from `docs/sidebar.webp`:

- White rail, 1px right border, no shadow.
- Active item: `accent-50` background, `accent-600` icon and label.
- Collapsed rail is icon-only and **gains tooltips**, which it does not have
  today. Required by the accessibility rules below.
- A bottom block shows avatar, person's name, academy name and role. On phones
  this stays in the header, where it is now.

The existing rail-expanded `localStorage` behaviour (`RAIL_KEY`, server always
renders collapsed) is kept as-is.

## 3 — Dashboard page

`src/app/(tenant)/dashboard/page.tsx` stays a server component and keeps its
single `dashboardData()` call. Sections move into
`src/components/dashboard/`, one file each, each taking a typed prop:

```
dashboard-header.tsx     greeting + Add student / Collect fee
todays-schedule.tsx      time · batch · capacity · coach · status
attendance-overview.tsx  "use client" — present / absent / not marked
revenue-overview.tsx     "use client" — month-by-month, with totals beside it
fee-collection.tsx       collected / pending / overdue
attention-required.tsx   absorbs the current At risk block
pipeline.tsx             the current Pipeline block, lifted out of page.tsx
quick-actions.tsx        five links, visually secondary
```

Only the two chart files are client components. Everything else renders on the
server, as today.

KPI cards reuse and extend `src/components/stat-card.tsx` — it already does
label, value, icon and "every number links to the list behind it". It gains an
optional supporting line and trend chip. **Do not add a second card component.**

The four KPIs: Active students · Today's attendance · Fees due · This month
revenue.

### Permissions

Every KPI and every section keeps exactly the `allows(ctx, …)` gate its data
has today — the gating lives in `dashboardData()`, which already omits whole
blocks the viewer may not see. A card whose data is absent does not render.
A viewer with no permitted block still gets the existing empty state.

Note `allows(ctx, permission)` takes two arguments.

### Copy

Greeting is "Good morning, {first name} 👋" with the date beneath it, replacing
the current date line. The 👋 is a greeting, not a UI icon, and is the one
emoji on the page. Subtitle stays one short line — no paragraph hints.

## 4 — Data

All additions are reads. No migration, no new table, therefore no new isolation
test (existing suite must still pass).

| Need | Change |
|---|---|
| Active students | `countByStatus()` in `students/repo` — already exists, returns `{active, paused, left, prospect}` |
| Coach name + capacity on today's classes | add `capacity` (`batches.capacity`) and a coach-name join to `classRows()` in `attendance/repo.ts:23`, widening `ClassRow`. Show the **effective** coach — `sessions.coach_id` when a substitute is set, else `batches.coach_id`, the same fallback `inScope()` already encodes |
| Month-by-month revenue | new `collectedByMonth(tx, branchIds, fromMonth, toMonth)` in `payments/repo`, mirroring `collectedByDay` |
| Overdue ₹ and fees due tomorrow | extend `owedSummary()` in `fees/repo.ts:368` with `overduePaise` and `dueTomorrow` |
| Waiting for batch allocation | new count in `students/repo`: active students with no active enrollment |
| This-month trend % | compare `thisMonth` against the previous calendar month via `collectedByMonth` |

`Dashboard` in `src/modules/dashboard/service.ts` grows to carry these. Money
stays `bigint` paise end to end and is formatted only in the component.

**Scoping caution:** "batches near capacity" is derived from *today's* classes,
because capacity arrives on `ClassRow`. It therefore means "near capacity among
batches meeting today", and the label must say so rather than imply all
batches.

## 5 — Dependency

`recharts@3.10.1`, pulled in by `pnpm dlx shadcn@latest add chart`. Verified:
its peer range is `^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`, so React 19.2.8
is supported. It is the charting library shadcn's `Chart` component wraps.

Both charts must carry accessible labels and a text equivalent of their values,
so the numbers survive without colour or hover — the existing `Columns`
component in `src/components/reports/bars.tsx` is the precedent.

`src/components/reports/bars.tsx` stays. Reports still use it; this slice does
not migrate it to Recharts.

## 6 — Accessibility

- Semantic landmarks; one `h1` per page, sections under `h2`.
- Visible focus ring on every interactive element (`--color-ring`).
- Icon-only controls — the collapsed rail especially — carry a tooltip and an
  accessible name.
- Touch targets ≥44px. Quick actions and schedule rows especially.
- Charts: accessible label plus the values in text.
- Status never carried by colour alone.

## 7 — Testing and done

- Extend `src/modules/dashboard/dashboard.integration.test.ts` for each new
  service field.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:isolation`.
- Chrome pass at desktop width and 390px: `/dashboard`, plus a spot check that
  `/students`, `/invoices` and `/settings` still look right under the new
  tokens.
- `pnpm seed` data must make every new dashboard section visibly non-empty.

## Follow-ups (not this slice)

- Per-page polish passes for the rest of the tenant area.
- Coach shell, portal and platform.
