# Students Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the students listing and detail pages against the settled Member + Guardian + Payer model.

**Architecture:** Both pages already exist (`/students`, `/students/[id]`). Server components fetch through `modules/students/service.ts`, which gates every block by permission the way `dashboardData` does, so a block the viewer may not see is **absent from the payload**, not hidden in the DOM. New read queries live in `modules/students/repo.ts`. UI reuses the dashboard's cards, the shell's tabs and `components/reports/bars.tsx`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Base UI, Lucide, Drizzle, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-students-pages-decisions.md`

## Global Constraints

- TypeScript strict, **no `any`**, no `as` to dodge a type error.
- **Money is `bigint` paise.** Format only at the UI edge via `formatPaise`. Never float, never a rupee string, never `Number()` on a paise value.
- **Timestamps are `timestamptz` UTC.** "What day is this" uses `todayIn(tenant.timezone)` — never `new Date().toISOString().slice(0,10)`, which filed early-morning IST records to the previous day.
- **Permission check on every new query**: `assertCan()` in the service. A block the viewer may not see is absent from the payload.
- **Comments one or two lines.** **UI text short** — a label or an ⓘ control, never a paragraph on screen.
- **Status colours are two-tier**: `-600` for fills, dots and bars; `-700` for text. The `-600` values fail WCAG AA as text.
- **Never colour alone** — every status carries an icon or text. `#16A34A` and `#EF4444` are ΔE 3.7 apart under deuteranopia.
- Reuse existing components. No new dependency. No migration — this plan adds no column.
- Phone-first: the listing becomes cards on mobile, never a horizontally scrolling table.

## Review Focus

1. **A student with two enrollments on different payers** must show **two** invoices in the fees card, each with its own bill-to name — never one, and never a merged total that implies a single bill. This is the case the whole payer migration exists for.
2. **A student with no guardian** (an adult gym member, `guardian_mode = off`) must render every card without throwing — Personal Information, Parent/Guardian and Fees all assume a guardian exists today.
3. **A month with no sessions** must not divide by zero in the attendance percentage, and must read "No classes" rather than "0%", which looks like total absence.
4. **A viewer without `invoices:read`** must get a detail page with no fees card at all, not an empty one — and the tab must not be offered.
5. **A student whose guardian link was removed** must still show their own attendance and history, while that guardian disappears from the Parent/Guardian card.

---

### Task 1: Listing KPIs

**Files:**
- Modify: `src/modules/students/repo.ts`, `src/modules/students/service.ts`
- Modify: `src/app/(tenant)/students/page.tsx`
- Test: `src/modules/students/students.integration.test.ts`

**Interfaces:**
- Produces: `type StudentCounts = { total: number; active: number; joinedThisMonth: number; paused: number }` and `studentCounts(tx, ctx): Promise<StudentCounts>`.

- [ ] **Step 1: Write the failing test**

```ts
it("counts students by status, and joins within the tenant's month", async () => {
  const c = await withTenant(T, (tx) => studentCounts(tx, owner));
  expect(c).toEqual({ total: 4, active: 2, joinedThisMonth: 1, paused: 1 });
});
```

- [ ] **Step 2: Run it and watch it fail** — `pnpm exec vitest run --project integration students -t "counts students by status"`. Expected: `studentCounts is not a function`.

- [ ] **Step 3: Implement.** One grouped query, not four. `joinedThisMonth` compares `joined_on` against `todayIn(tenant.timezone)`'s month, **not** UTC. Soft-deleted rows (`deleted_at`) are excluded from every count. `assertCan(ctx, "students:read")`.

- [ ] **Step 4: Prove it can fail.** Change the month boundary to UTC, confirm the test goes red between 00:00 and 05:30 IST, restore.

- [ ] **Step 5: Render** four cards reusing the dashboard KPI component. "Inactive" is labelled **Paused**, per the spec. Absent entirely without `students:read`.

- [ ] **Step 6: Commit** — `git add` the four files by explicit path.

---

### Tasks 2-8 (design level)

**Deliberately not step-specified.** The migration plan took the same approach and it held: each task below names its files, its decision and its test, and the implementing agent works out the code. Specifying code for a redesign that has not been seen in a browser yet produces confident wrong detail.

**Task 2 — Listing toolbar and table.** `students/page.tsx`, a new `components/students/student-table.tsx`. Search plus filters: program, batch, coach, status, fee status, joined date. Columns **Student (avatar, name, code) · Program · Batch · Coach · Attendance · Fee status · Status · Actions**. Mobile renders cards, not a scrolling table. Filters are URL state so a filtered list is linkable. *Test: a filter combination returns the right students and the count matches the table.*

**Task 3 — Detail header and tab shell.** `students/[id]/page.tsx`. Avatar, name, `students.code`, program · batch, status pill. Tabs **Overview · Attendance · Fees & Payments · Batches · Documents · Activity**. Documents and Activity ship as honest empty states — neither a documents table nor the storage adapter exists. A tab the viewer lacks permission for is **not offered**. *Test: a viewer without `invoices:read` gets no fees tab.*

**Task 4 — Overview: personal, guardians, enrollment.** The student's **own** address (migration 0039). Email shows the **guardian's, labelled whose** — "Email (father)" — and an adult student's `self` relation shows their own with no special casing. All guardians listed with relation and `is_manager`. Enrollment card: program, batch, coach, joined date, fee plan, status, next due. *Test: a student with two guardians shows both; a student with none renders without throwing.*

**Task 5 — Overview: attendance summary and chart.** Overall percentage plus present/absent/late/not-marked counts, and a monthly trend. **A month with no sessions reads "No classes", never "0%".** Not-marked is never counted as absent — the dashboard shipped that bug once. Prefer the CSS primitives in `components/reports/bars.tsx` over Recharts; a trend line is the one case where Recharts earns its client JS. *Test: a month with zero sessions; a month where nothing was marked.*

**Task 6 — Attendance calendar.** `components/students/attendance-calendar.tsx`. Month grid with Present / Late / Absent / Holiday / No class, a legend, and a monthly summary. Holidays come from `listHolidays`. **Every state carries an icon or text, never colour alone.** Touch targets ≥44px. *Test: a holiday renders as a holiday, not an absence.*

**Task 7 — Fees card (Review Focus 1).** Current plan, this month's status, last payment, next due, outstanding, and a short payment history. **Payer-aware:** a student with two enrollments on different payers has **two invoices a month**, each with its own `bill_to_name`, and the card must show both. Money stays `bigint` to the UI edge. *Test: the two-payer student shows two invoices with the right names and no merged total.*

**Task 8 — Current Program card.** Program, level if the activity has one, batch, coach. **No progress bar** — there is no progression module, and a percentage derived from attendance would be read as skill. The bar waits. *Test: the card renders for an activity with levels and one without.*

---

## Self-review notes

- **Spec coverage:** every section of the brief maps to a task except Documents and Activity (placeholders by decision) and the progress bar (no source).
- **Review Focus:** items 1-5 are each assigned — 1 to Task 7, 2 to Task 4, 3 to Task 5, 4 to Task 3, 5 to Task 4.
- **Not in scope:** the sidebar's Referrals and Notifications (do not exist, declined three times); "Courses & Programs" as its own nav item (it is a tab under Batches since `f7a4a9a`).
