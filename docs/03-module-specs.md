# 03 — Module Specs

One section per V1 module. Each has: what it is for, the screens, the rules that
are easy to get wrong, and acceptance criteria.

**Acceptance criteria are the contract.** If a criterion here is ambiguous, stop
and ask before implementing. Do not invent business rules about money, discounts,
refunds or attendance.

---

## 1. Platform admin

**Purpose:** you onboard and support academies.

**Screens:** tenant list, create tenant, tenant detail (plan, modules, limits,
usage), suspend/reactivate, impersonate (read-only), platform-wide message log.

**Rules**

- Creating a tenant creates, in one transaction: the tenant, a default branch, the
  4 preset roles with their permission sets, the owner staff user, the default
  label pack, and the current financial year's number series rows.
- Suspending a tenant blocks staff login with a clear message and a contact
  route. It never deletes data.
- Impersonation is read-only, shows a persistent banner in the tenant UI, and
  writes an audit row containing a typed reason.

**Acceptance**

- [ ] A new tenant is usable (login → add student → mark attendance) with zero
      manual SQL
- [ ] Impersonation cannot write, and is visible in the tenant's own audit log
- [ ] Plan limits (max students/staff/branches) are enforced server-side with a
      clear error, not a crash

---

## 2. Staff, roles, permissions

**Purpose:** control who can do what.

**Screens:** staff list, invite/create staff, assign roles, branch assignment,
role editor (tick permissions), deactivate staff.

**Preset roles and their permission sets:**

| Role | Gets |
|---|---|
| Owner | everything, via `is_owner` bypass; role is not editable or deletable |
| Manager | everything except `staff:manage`, `integrations:manage`, `fees:refund` |
| Teacher | `students:read`, `sessions:read`, `attendance:mark`, `sessions:note` |
| Front Desk | `students:*`, `enquiries:*`, `fees:collect`, `invoices:read`, `attendance:mark` |

**Rules**

- Every tenant always has at least one active owner. Blocked at the service layer,
  with a clear message, not a constraint violation.
- Deactivating a staff member revokes their sessions immediately.
- Changing a role's permissions invalidates the cached context of every staff
  member holding that role.
- Teachers only see batches they are assigned to as coach, unless they also hold
  a role with `students:read_all`.

**Acceptance**

- [ ] A Teacher hitting a fees API route gets 403, even by direct URL
- [ ] A staff member with two roles gets the union of permissions
- [ ] Removing the last owner is refused
- [ ] Disabling a module hides its nav **and** 403s its routes, while leaving
      role–permission rows intact; re-enabling restores them exactly

---

## 3. Students, households, guardians

**Purpose:** the people register.

**Screens:** student list (filter by batch, status, branch, dues), add student
(single-page form, under 60 seconds), student profile (tabs: overview,
attendance, fees, notes, documents), household view showing all siblings.

**Rules**

- Adding a student creates a household automatically unless the staff member
  picks an existing one. Offer "link to existing family" when the guardian phone
  already exists in the tenant.
- `code` is auto-generated per tenant using the number series pattern, editable
  once, then locked.
- A student cannot be hard-deleted once they have attendance or invoices. Mark
  `status='left'` with a reason.
- Consent is captured at creation: data processing (mandatory), photo (optional,
  separately revocable).
- Adult students: the student is also their own guardian record, so billing and
  portal login work unchanged.

**Acceptance**

- [ ] Adding a second child to an existing family reuses the household and the
      guardian, with no duplicate guardian row
- [ ] Student profile shows attendance % over the last 30 days and outstanding
      dues without a second page load
- [ ] Search by partial name or partial phone returns in under 300 ms with 5,000
      students seeded
- [ ] Photo does not render anywhere if photo consent is absent or revoked

---

## 4. Enquiries and trials

**Purpose:** convert walk-ins and WhatsApp enquiries into admissions. This is the
module owners will show their friends.

**Screens:** enquiry board grouped by status, add enquiry (10 seconds: name,
phone, interested in), enquiry detail with activity timeline, "today's follow-ups"
list, conversion funnel report.

**Rules**

- Converting an enquiry creates the student, household and guardian and links back
  via `converted_student_id`. The enquiry is never deleted.
- Lost enquiries need a reason from a fixed list plus optional free text. The
  reason list is what tells the owner why they are losing people.
- A follow-up due today appears on the dashboard of the assigned staff member.
- Trial booking attaches the enquiry to a real session so the teacher sees the
  trial student on the roster, visually distinct from enrolled students.

**Acceptance**

- [ ] Enquiry → trial booked → trial attended → converted, with the student's
      `joined_on` set to the conversion date
- [ ] Funnel report shows count and percentage at each stage for a date range
- [ ] Source breakdown shows which channel actually converts
- [ ] A trial student appears on the teacher's roster and can be marked present
      without being enrolled

---

## 5. Programs, batches, schedule, sessions

**Purpose:** define what is taught, when, by whom, where.

**Screens:** program list, batch list, batch create (name, program, coach, days,
times, capacity, fee plan, start date), batch detail with roster, week calendar
per branch, day view per coach, holiday calendar.

**Rules**

- A batch has one or more weekly schedule rules. Different days may have different
  times, which is common in tuition.
- Sessions are generated by a nightly job 21–60 days ahead, skipping holidays.
- Editing a schedule regenerates only future sessions with **no attendance rows**.
  Sessions that already have attendance are history and are never touched.
- Cancelling a session requires a reason and triggers a WhatsApp notice to
  enrolled guardians.
- Substitute teacher: set `sessions.coach_id` for that occurrence only.
- Capacity is a soft warning in V1, not a hard block. Roster academies routinely
  squeeze in one more student.

**Acceptance**

- [ ] A batch running Mon/Wed/Fri 6–7 PM starting the 1st generates exactly the
      right dates for the next 30 days, skipping a configured holiday
- [ ] A 5:30 AM IST batch shows on the correct local date (timezone test)
- [ ] Re-running the generation job creates zero duplicate sessions
- [ ] Changing the time from 6 PM to 7 PM moves future sessions and leaves past
      sessions and their attendance untouched

---

## 6. Enrollment

**Purpose:** connect a student to a batch and a fee plan.

**Screens:** enroll student (from student profile or batch roster), pause, resume,
transfer batch, mark left.

**Rules**

- Enrollment sets the fee plan, defaulting from the batch, overridable per student.
- **Pause** stops invoice generation from the pause date, and does not remove the
  student from the roster history.
- **Transfer** closes the old enrollment (`transferred`), opens a new one, links
  them. Never mutate `batch_id` on an existing enrollment.
- **Leave** sets an end date; any invoice for a period after that date is voided,
  and any credit balance surfaces on the household as an unallocated advance.
- One student may hold several active enrollments (karate + dance). Each generates
  its own invoice line.

**Acceptance**

- [ ] Transfer mid-month does not double-bill; the old plan stops and the new one
      starts on the transfer date, prorated per the tenant's proration setting
- [ ] Attendance history stays attached to the batch the student actually attended
- [ ] A paused student generates no new invoices and shows as paused on rosters

---

## 7. Attendance

**Purpose:** the daily habit that makes the product sticky. If this is not fast on
a phone, nothing else matters.

**Screens:** "Today" (coach's sessions), roster (student list with one-tap
present/absent), bulk "mark all present" then correct exceptions, session notes,
attendance history per student, monthly attendance grid per batch.

**Rules**

- Default action is **mark all present, then tap the absentees**. That is how a
  teacher actually works. Do not make them tap 30 times.
- Unmarked is a distinct state from absent. Never auto-mark absent.
- Offline: today's roster is cached; marks are queued in IndexedDB; sync uses
  `(session_id, student_id)` as the idempotency key.
- A mark can be corrected within 48 hours by anyone with `attendance:mark`;
  after that it needs `attendance:amend`. Every change is audited.
- Marking attendance for a future session is refused.

**Acceptance**

- [ ] Marking a 30-student roster takes under 15 seconds on a mid-range Android
      phone on 3G
- [ ] Aeroplane mode: mark 30 students, reconnect, all 30 sync exactly once
- [ ] Marking the same session twice from two devices does not create duplicates
- [ ] Monthly grid for a 40-student batch renders in under 300 ms

---

## 8. Fees and invoicing

**Purpose:** know who owes what.

**Screens:** fee plan list/editor, discount list, assign discount to student,
invoice list with filters (unpaid, overdue, this month), invoice detail, manual
invoice creation, bulk invoice generation preview.

**Rules**

- The nightly job generates invoices for cycles starting that day, one invoice per
  household per cycle, with one line per active enrollment. Family invoicing is
  the default because families pay once for all their children.
- Discounts apply at the line level, before summing. Round half up to whole paise.
- Admission fee appears as a separate line on the first invoice only.
- Late fee is added by a job after `due_date + grace_days`, as its own line, and
  only if the plan has one configured.
- Invoices are never edited after issue. Void and reissue, with the void reason
  recorded and the number retained.
- **Always show a preview before bulk generation.** An owner who accidentally
  invoices 400 families wrongly will stop trusting the system permanently.

**Acceptance**

- [ ] A family with two children in different programs gets one invoice with two
      lines and a correct sibling discount
- [ ] Totals reconcile exactly: lines − discount + tax = total, in paise
- [ ] Re-running generation for the same period creates no duplicates
- [ ] A voided invoice keeps its number and never reappears in dues
- [ ] Proration on mid-cycle join matches the rule the tenant configured

---

## 9. Payments and receipts

**Purpose:** record money and prove it was received.

**Screens:** collect payment (from invoice, from household, or standalone
advance), payment list, daily collection sheet, receipt PDF, refund.

**Rules**

- Recording a payment: pick method, amount, date, reference; then allocate across
  one or more open invoices, oldest first by default, with manual override.
- Over-payment stays as an **unallocated advance** on the household and is auto-
  allocated to the next invoice. Do not refuse the payment.
- Receipt number is issued from `number_series` in the same transaction.
  Gapless, per branch, per financial year.
- Receipt PDF is generated on demand and sent on WhatsApp with one tap.
- Refund needs `fees:refund`, a reason, and creates a `refunds` row. It never
  deletes the payment.
- Daily collection sheet, split by method, is what the owner checks at closing
  time against the cash box. Make it one tap from the dashboard.

**Acceptance**

- [ ] ₹1,000 paid against a ₹1,500 invoice leaves status `part_paid` and
      ₹500 outstanding
- [ ] ₹5,000 paid against ₹3,000 of invoices leaves ₹2,000 as an advance, visible
      on the household, auto-applied next cycle
- [ ] Receipt numbers for a tenant across a financial year have no gaps and no
      duplicates, under 50 concurrent inserts
- [ ] Refunding does not change the original receipt

---

## 10. Messaging (WhatsApp)

**Purpose:** the reminder loop that gets fees paid and parents informed.

**Six templates to get approved early** — approval takes days, so submit them in
week one:

| Key | Sent when |
|---|---|
| `welcome` | student admitted |
| `receipt` | payment recorded |
| `fee_due` | 3 days before due date |
| `fee_overdue` | due date + 3, +7, +15 |
| `absent` | evening of an unexplained absence |
| `class_cancelled` | session cancelled |

**Rules**

- Every automated send is tenant-configurable: on/off per template, and the send
  hour is a tenant setting. Nobody wants a 9 PM fee reminder.
- Tenants connect their own WhatsApp number. Until they do, the system falls back
  to the **copy-to-clipboard + `wa.me` link** flow, which works from day one with
  zero setup and zero cost.
- A guardian receives at most one automated message per day per category.
  Cap it, or your first pilot will mute the number.
- Every send is logged with delivery status from the provider webhook.
- Language per tenant: English, Hindi, Marathi. Template body is editable.

**Acceptance**

- [ ] Fee reminder sends to the primary guardian of each household with an overdue
      invoice, once, with the correct amount and a link
- [ ] Turning a template off stops sends immediately
- [ ] A failed send is visible with its error, and is retryable
- [ ] With no WhatsApp integration connected, the manual copy flow still works end
      to end

---

## 11. Dashboard and reports

**Purpose:** answer the four questions an owner actually asks.

**Owner dashboard, in this order:**

1. Today: sessions scheduled, attendance marked, students present
2. This month: collected, outstanding, new admissions
3. Needs attention: overdue invoices, unmarked sessions, follow-ups due today
4. At risk: students with attendance under 60% in 30 days, or two unpaid cycles

**Reports (all with a date range, all exportable to CSV):**

- Collection register by day / method / staff
- Outstanding dues by household, aged 0–30 / 31–60 / 60+
- Attendance summary per batch and per student
- Admissions and dropouts
- Enquiry funnel by source

**Rules**

- Every report is branch-scoped for branch-scoped staff.
- Every number on the dashboard links to the underlying list. A number you cannot
  click into is a number nobody trusts.

**Acceptance**

- [ ] Dashboard renders in under 500 ms on the 800-student seed
- [ ] Collection total for a day matches the sum of that day's receipts, exactly
- [ ] CSV export opens cleanly in Excel with UTF-8 Indian names intact

---

## 12. Guardian portal

**Purpose:** reduce the number of phone calls the academy receives.

**Screens:** phone OTP login, children list, per child: attendance calendar,
fee dues, receipts, batch timings, notices.

**Rules**

- One phone number may map to guardian records in more than one tenant. After
  OTP, if there are several, show an academy picker.
- Read-only in V1 except: download receipt, pay via payment link (V1.5), and
  submit a leave note.
- Never show other students' names, marks, or fee information. Ever.

**Acceptance**

- [ ] A parent with two children in one academy sees both, and nothing else
- [ ] A parent with children in two different tenant academies picks between them
      after one OTP, with no data crossing between tenants
- [ ] Attendance shown to a parent matches exactly what the teacher marked

---

## 13 — Progression (V1.5, not V1)

Rules:
- Tracks and levels are defined per program by the academy.
- Promoting a student records level, date, assessor and optional score.
- Criteria in `progression_levels.criteria` are advisory: show "eligible" badges,
  never auto-promote. A sensei decides belts, not software.
- A certificate PDF can be generated from a per-tenant template.

Acceptance:
- [ ] Karate belts, swim levels and hifz juz all model without schema changes
- [ ] Student profile shows a progression timeline
- [ ] Eligibility badge appears when attendance criteria are met

---

Build this only once a pilot academy asks for belts, levels or milestones. One
generic mechanism covers karate belts, swim levels, dance grades and hifz juz.
