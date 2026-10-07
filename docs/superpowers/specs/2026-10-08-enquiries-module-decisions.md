# Enquiry / Lead Management — decision record

Date: 2026-10-08 · Status: **decisions taken, not yet specced into tasks**
Related: `2026-10-07-finance-module-decisions.md`, `2026-10-07-reports-analytics-decisions.md`

## Inventory, measured at `8fdfd18`

This module is the furthest along of the three briefs. Already built:

| Brief asks for | Exists |
|---|---|
| Board by stage with counts | `enquiryBoard` — `BOARD_VIEWS`, `counts`, today's follow-ups first |
| A Follow-ups view | already one of `BOARD_VIEWS` |
| Activity timeline | `app.enquiry_activities` — `kind`, `note`, `toStatus`, `staffId`, `happenedAt` |
| Trial tracking | `app.trial_attendances` |
| Assigned staff | `enquiries.owner_staff_id` |
| Lead source | `enquiries.source`, 9 values |
| Lost reason | `lost_reason` + `lost_note` |
| Convert to student | `modules/enquiries/convert.ts` + `convert-enquiry.tsx` |
| Enquiry analytics | `enquiryFunnel` in reports, `enquiry-report.tsx` |
| Stage timestamps | `contacted_at`, `trial_booked_at`, `trial_done_at`, `won_at`, `lost_at` |

**The brief's instruction to "use clean typed mock data" does not apply.** The
data is real and `pnpm seed` builds it. Mock data in this codebase would be a
defect, not a placeholder — see the dashboard rule about never showing invented
numbers.

## Decisions, 2026-10-08

### 1. Keep the six real stages

`new, contacted, trial_booked, trial_done, won, lost` (agreed 2026-09-25,
`modules/enquiries/lists.ts`). The brief's **Follow-up** is not a stage — it is a
date every enquiry carries regardless of stage, which is why a Follow-ups view
already exists. **Interested** overlaps `trial_done`.

No migration, no reports-funnel change, no retraining staff.

### 2. Follow-ups become their own table

Today there is one `next_follow_up` **date** per enquiry: no time, no type, no
assignee of its own, no history. Rescheduling overwrites and leaves no trace.

A `follow_ups` table, one row per scheduled follow-up:
`enquiry_id, type, scheduled_at (timestamptz), assigned_to, completed_at, note`.

Type is one of **call, whatsapp, visit, trial reminder, payment reminder, other**
(from the brief). This gives real overdue tracking, a reschedule trail, and the
history that makes "called twice, no answer" visible.

**This is the point of the module** — the brief's own stated goal is "never
forget to follow up with a potential student", and a single overwritable date
cannot support that.

Needs a migration, an **isolation test** (it is tenant-scoped), and a decision at
spec time on whether `enquiries.next_follow_up` becomes derived or is dropped.

### 3. No drag-and-drop dependency — move via a menu on the card

A "Move to" action on each card. Works on a phone, which is where staff use this
between classes; works with a keyboard and a screen reader; adds nothing to the
bundle. Drag-and-drop would still have needed the menu as a touch fallback, so it
is additive work rather than a replacement.

Revisit if staff actually ask for dragging on desktop.

### 4. Four new fields on the enquiry

**priority** (low/normal/high), **date of birth**, **preferred timing**, **gender**.

- Age is stored as **date of birth**, not age, so it stays correct over time —
  the same rule the identity work uses for the login age threshold.
- Preferred timing is free text ("Evening, 6 PM"), separate from `batch_id`:
  it records what a parent said before any batch is chosen.
- Gender is stored because some karate and swimming batches place by it.

One migration carries all four plus the `follow_ups` table.

## What is genuinely new to build

Side-by-side Kanban columns (the board filters by stage today rather than showing
columns), the KPI row, quick actions on a card (call, WhatsApp, note, schedule,
mark done), the detail drawer, the Today/Overdue/Upcoming follow-ups view, and
the dashboard enquiry widget.

## Conflicts with settled decisions

- **Sidebar.** The brief lists **Referrals** and **Notifications** under ACADEMY.
  Neither exists and neither was agreed. Do not add them.
- **"Website" as a source** does not exist. Real sources: walk-in, phone call,
  WhatsApp, referral, Instagram, Facebook, Google, poster/banner, other.
- **Dashboard.** The brief is right that existing KPIs must stay. The dashboard
  already has an "Attention required" block; enquiry alerts belong **in it**,
  not in a second one.

## Sequencing

1. Member + Guardian + Payer migration (Tasks 8b-10).
2. Finance.
3. Reports.
4. This.

Enquiries is last of the four: converting an enquiry creates a student, a
guardian and an enrollment, all of which are mid-change until the migration
lands. It is also the least broken of the three briefs, so it waits.
