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
| Front Desk | `students:*`, `enquiries:*`, `enrollments:manage`, `fees:collect`, `invoices:read`, `attendance:mark` |

**Permission catalog** (`src/lib/auth/permissions.ts` is the source of truth and is
synced into `permissions`; `module` is the `enabled_modules` flag a key belongs to,
`core` is always on):

| module | keys |
|---|---|
| core | `staff:read`, `staff:manage`, `settings:manage`, `integrations:manage`, `audit:read` |
| students | `students:read`, `students:read_all`, `students:create`, `students:update`, `students:import` |
| enquiries | `enquiries:read`, `enquiries:create`, `enquiries:update`, `enquiries:convert` |
| batches | `programs:manage`, `batches:read`, `batches:manage`, `sessions:read`, `sessions:note`, `sessions:manage`, `enrollments:manage` |
| attendance | `attendance:read`, `attendance:mark`, `attendance:amend` |
| fees | `fee_plans:manage`, `invoices:read`, `invoices:manage`, `fees:collect`, `fees:refund`, `payments:read` |
| messaging | `messages:read`, `messages:send`, `messages:manage` |
| reports | `reports:view`, `reports:export` |

Owner holds no permission rows: access comes from `staff_users.is_owner`. A staff
row whose `password_hash` is `!` has no password yet and cannot log in until the
invite / set-password flow is completed.

**Rules**

- Every tenant always has at least one active owner. Blocked at the service layer,
  with a clear message, not a constraint violation.
- Deactivating a staff member revokes their sessions immediately.
- Changing a role's permissions invalidates the cached context of every staff
  member holding that role.
- Teachers only see batches they are assigned to as coach, unless they also hold
  a role with `students:read_all`.

**Agreed 2026-09-23** (`src/modules/staff/`, `src/modules/dashboard/`)

- No code checks a role name: every decision is a permission key (`can`/`allows`).
  The 4 presets are only a new academy's starting data.
- Anyone with `staff:manage` creates roles (optionally copying another's ticks),
  renames them, ticks permissions and deletes them. Owner stays "everything" and
  can't be edited. A role held by active staff can't be deleted. Names are unique.
  Every change is audited and clears holders' cached access (next page load).
- New staff get a one-time invite link, valid 7 days, to copy or send on WhatsApp;
  they set their own password. A new link expires older ones and, once used,
  signs the person out everywhere (so it doubles as a password reset). Only the
  token's hash is stored.
- The dashboard is for everyone in the admin shell; each block appears only with
  its permission (students, today's classes, present today, batches, staff).
  Sidebar and shell are chosen from permissions too.

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

**CSV import** (agreed 2026-09-23; `src/modules/students/import*.ts`)

- Choose file → match columns → check (a dry run of the real import, rolled
  back) → import. The file stays in the browser; the server re-reads it each step.
- One consent declaration per file: every imported student gets data-processing
  consent recorded as `paper`, by the importing staff member, with time and IP.
  Photo consent only where a column says yes.
- A row joins a family by phone. If that family already has a student with the
  same name (Unicode-normalised, spacing and case ignored) the row is skipped,
  never updated — so re-running a file, duplicate rows and students added by hand
  all dedupe the same way.
- Errors (row not imported): no or unreadable name, no or invalid phone, unknown
  branch. Warnings (imported with a note): unreadable date/gender/relation/photo,
  extra numbers in a phone cell, no parent name ("Parent of …"), phone already
  belonging to another parent, a minor's own phone (not kept).
- Dates are day-first (`03/04/2015` is 3 April). Adults with no named parent are
  their own contact. Up to 2,000 rows per file. Failed rows download as CSV with
  an "Import error" column, ready to fix and re-upload.

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

**Built as** (agreed 2026-09-25; `src/modules/enquiries/`)

- Add: name, phone and program; parent, source, batch, follow-up (tomorrow),
  assignee and a note are optional. A phone already on an open enquiry or a
  family is flagged, never blocked.
- Board: Follow-ups (due today or earlier, mine first) and a tab per status.
  The first call, message or visit moves New to Contacted.
- Sources: Walk-in, Phone call, WhatsApp, Referral, Instagram, Facebook,
  Google, Poster/banner, Other. Lost reasons: Fees too high, Timing doesn't
  suit, Too far, Joined elsewhere, Not interested now, No reply, Other.
- Trials: one or more, each in a real class; free, outside capacity, cancelled
  but never deleted. On the roster with a Trial chip, marked like a student.
  Trial done once one is attended; a missed one keeps it at Trial booked.
- Convert: one step, phone carried over; asks only the parent's name and
  relation (or an adult's date of birth), batch, start date and consent.
- Report tab: enquiries received in a date range; each stage's first-reached
  time makes the funnel; conversion by source; lost reasons.

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

**Timing, closing, holidays** (agreed 2026-09-23; `src/modules/batches/`)

- Weekly timing is stored as one rule per weekday with `effective_from/to`. A
  change takes a From date (today or later): rules in force then end the day
  before, rules not yet in force are dropped, the past is never rewritten. Before
  a batch has started, its timing is simply replaced.
- Closing sets `status = ended` and a last day; it is reversible (Reopen). Timing
  can't change while closed. Deleting is a soft delete, refused while the batch
  is in use (enrollments register that check) — "close it instead".
- The coach must be able to work in the batch's branch; the owner can coach.
- One holiday per date per branch; `NULL` branch means all branches and is also
  unique per date. Staff limited to some branches add holidays for those only.

**Sessions** (agreed 2026-09-23; `src/modules/sessions/`)

- Kept filled to 60 days ahead: nightly (`sessions.generate`, pg-boss, 01:30 IST)
  and at once when a batch's timing or status, or a holiday, changes.
- Times are the tenant's wall clock. A class belongs to the day it starts, may
  cross midnight (up to 8 hours) and always lasts its scheduled length.
- Past or held sessions are never changed. A day whose class already started
  gets no second class from a later timing change. Manual cancellations stay.
- A holiday added later cancels that day's classes (reason "Holiday"); removing
  it restores them. Dates that were already holidays are simply skipped.
- Timezone edge cases, all tested: 5:00 AM IST falls on the previous UTC day;
  5:30 AM IST is 00:00 UTC; "today" is the tenant's; the server timezone never
  matters; classes crossing or ending at midnight; holidays and timing changes
  by local date; year end and 29 Feb; DST gap moves forward, DST overlap takes
  the first; +5:45 offsets; a tenant changing timezone moves future classes.

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
- **Leave** sets an end date on the enrollment (changed 2026-09-24):
  - Recurring plans: any invoice for a period starting after the end date is
    voided automatically.
  - Term (installment) and one-time plans: remaining unpaid installment invoices
    are **not** voided. They stay issued and keep showing in dues. The leave
    screens ("Mark as left" on the profile, "Leave" on a batch) list them, each
    with a direct link to void it by hand: the normal void, with a reason, the
    number kept and an audit entry.
  - Any credit balance surfaces on the household as an unallocated advance.
  - Voiding an invoice that has money on it (paid in full or in part) releases
    its payment allocation. The payment and its receipt stay unchanged; the
    release is recorded and audited, never deleted; the amount becomes an
    unallocated advance on the household, applied to the next invoice or refunded
    with `fees:refund`. Built with payments (Prompt 15).
- One student may hold several active enrollments (karate + dance). Each generates
  its own invoice line.

**Agreed 2026-09-23** (`src/modules/enrollments/`)

- Front Desk enrolls from the student page ("Join a batch"); owners and managers
  also from the batch page ("Add students").
- Only active students join, from a date (default today) not before the batch
  starts; closed batches take no one; one enrollment per student per batch at a time.
- Pause and resume apply today. A move on day D ends the old enrollment D−1 and
  starts the new one on D; a move on the joining day leaves the old one empty.
- Leave sets the last day; the student stays on the roster until then.
- Marking a student Left, Paused or Active on their profile carries to all their
  batches. A batch or student with enrollments can only be closed or marked left.
- Fees (slice 15): `fee_plan_id` comes from the batch's plan; leaving voids later
  recurring invoices and leaves installments as above; a move keeps the cycle in
  progress (no proration, see §8).

**Acceptance**

- [ ] Transfer mid-month does not double-bill; the old plan stops and the new one
      starts on the transfer date, prorated per the tenant's proration setting
- [ ] Attendance history stays attached to the batch the student actually attended
- [ ] A paused student generates no new invoices and shows as paused on rosters
- [ ] A student on a 3-installment term plan who leaves after paying installment 1
      keeps installments 2 and 3 issued and unchanged, and the leave screen lists
      both as voidable

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

**Agreed 2026-09-23** (`src/modules/attendance/`)

- The edit window is 48 hours from class start. After it the register locks:
  any write, new or changed, needs `attendance:amend`.
- A class can be marked any time on its own date (tenant timezone), even before
  it starts. Later dates and cancelled classes are refused.
- Roster = students enrolled on the class date, plus anyone already marked.
  Paused students sit last, greyed, not markable and not counted.
- Teachers see the classes they take (batch coach, or the substitute on the
  session); `students:read_all` holders see every class in their branches.
- "Mark all present" fills only unmarked rows and can be undone; a tap cycles
  Present → Absent → Late; a long press adds a note. Nothing is sent until Save.
- One upsert per save on `(session_id, student_id)`: two phones never duplicate,
  the later save wins, and each save is one audit row listing its changes.
  Saved marks can be changed but never cleared (no deletes). The class becomes
  `held`, so the session generator never touches it.
- % attendance = (present + late) / (present + late + absent); unmarked and
  excused don't count.

**Offline, agreed 2026-09-24** (`public/sw.js`, `src/lib/offline/`)

- A hand-written service worker (production only) caches `/_next/static` and the
  pages `/today` and `/sessions/*` (network first). Opening Today also caches every
  roster of the day. Any other page offline shows "Only attendance works offline".
- Save with no signal keeps the marks on the phone (IndexedDB, one row per class
  and student, latest mark wins) and says "Offline — N marks will sync".
- Sync runs on load, on reconnect, when the app comes back to the foreground and
  every 30 s while anything waits: one PUT per class, `source = offline_sync`.
  Replays are harmless (the upsert key). A refused class (e.g. the 48 h lock) is
  kept as "couldn't sync" with the reason and a Discard button.
- The header shows "3 unsynced" while marks wait. A save that replaced another
  staff member's mark still wins, and the screen says whose marks it replaced.
- Sign out sends waiting marks first and refuses while any remain; then it clears
  the cached pages and the queue.

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

**Agreed 2026-09-24** (`src/modules/fees/`)

- Plans: recurring (monthly, quarterly, half-yearly, yearly), term (installments in
  `metadata`, docs/04 format) and one-time. Package is stored, not billed (V2).
- `invoices.generate` runs at 02:00 IST and makes **drafts**: one per family,
  branch and billing day; each term installment gets its own. Cycles that began in
  the last 7 days are caught up; a billing key per charge means nothing is billed
  twice. "Generate now" runs it on demand.
- To review shows the drafts' count and total; the owner issues them, and only then
  is the number taken. Parents see nothing before that.
- A new student gets the batch's plan; it can be changed per student, and a batch's
  plan can be given to students already in it.
- Joining mid-cycle pays the full cycle or only the days left (academy setting).
  Long cycles run from the join month. A batch move keeps the cycle in progress;
  the new plan starts next cycle (this replaces "prorated" in §6 acceptance).
- Due = billing day + the plan's days to pay. Overdue is worked out when read.
- Admission: once, with the first charge of a student's first batch in a program.
- A student's discount always has a reason, applies to fee lines before tax, never
  goes past the fee, and prints as its own line. Ending one stops it from today.
- GST only with a GSTIN, per line on the fee after discount.
- Void keeps the number; the charges stay billed unless "Bill it again" is ticked.
  Leaving a batch voids invoices for later periods, paid or not, and drafts the
  rest again; installments stay due (§6). Voiding an invoice with money on it moves
  that money to the household advance (§6). A ₹0 invoice is paid on issue.

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

**Agreed 2026-09-24** (`src/modules/payments/`, slice 16)

- Collect: family, amount, method (cash first, then UPI, bank transfer, cheque),
  optional reference. The received date is today unless changed: up to 7 days
  back, never in the future, never before the financial year began.
- Allocation: oldest first (due date, then number), or invoices picked by hand.
  Only the family's issued or part-paid invoices in the payment's branch, never
  more than an invoice's balance. What is left is the family's advance in that
  branch.
- The advance is used automatically, oldest invoice first, when the family's next
  invoices are issued. Voiding an invoice with money on it adds that money to the
  advance (§6).
- The receipt number comes from the receipt series in the payment's own
  transaction. The receipt shows what the payment paid when it was recorded;
  later refunds, voids and advance use never change it.
- The receipt is a printable page; the browser saves it as PDF. No PDF library:
  they don't draw Devanagari or Urdu names reliably. A PDF file comes with
  WhatsApp (Prompt 17).
- A double tap is one payment: the collect form sends a request id, and the same
  id again returns the first payment.
- Nothing is edited. A mistake is cancelled on the same day, with a reason, by
  whoever recorded it or anyone with `fees:refund`: the number stays, the money
  comes off its invoices and off the day's total, and the sheet lists it struck
  through. From the next day, only a refund.
- Refunds: `fees:refund`, a reason, and how the money went back. They come out of
  the payment's unused advance first, then from the invoices it paid, which
  reopen. Never more than is left on the payment.
- Daily collection sheet: one branch, one day, counted by the day a payment was
  recorded in the academy's timezone, so a day already checked never changes;
  back-dated payments show their received date. Split by method and by
  collector. Cancelled receipts are listed, not counted. Refunds paid out that
  day are listed by method; cash in hand = cash collected − cash refunded.
- Not in this slice: gateway payments and webhooks (Prompt 16), receipts on
  WhatsApp (Prompt 17), the UPI screenshot (needs file storage), and adjustment
  entries that move money between a family's invoices.

**Agreed 2026-09-25** (Razorpay, `src/modules/integrations/`, slice 17)

- The owner (`integrations:manage`) pastes the academy's own key id, key secret
  and webhook secret in Settings. Saving checks the keys with Razorpay first. The
  secrets are sealed with the app key (`src/lib/crypto`), never shown again and
  never logged. Test keys (`rzp_test_`) are labelled test mode.
- Anyone who can collect (`fees:collect`) makes a payment link from an invoice,
  for its balance, paid in full (no part payments on a link). One live link per
  invoice: the same balance reuses it; a changed balance cancels it in Razorpay
  and makes a new one.
- Staff share the link: Copy, or Share on WhatsApp, which opens WhatsApp on their
  phone with the message filled in. Sending it for them comes with Prompt 17.
- Razorpay's webhook comes to `/api/webhooks/razorpay/<academy>`. The signature
  is checked with that academy's webhook secret before anything is read; each
  event is stored once per academy by Razorpay's event id and handled in the same
  transaction.
- A paid link becomes a payment: method Online, no collector, the next receipt
  number, received on the day Razorpay captured it and counted on the day it is
  recorded. It pays the link's invoice up to its balance; anything over is the
  family's advance. `payment.captured` and `payment_link.paid` may come in either
  order: the Razorpay payment id makes it one payment.
- Online payments are refunded in the Razorpay dashboard; its refund webhook
  records the refund here (advance first, then the invoice reopens), once per
  Razorpay refund id. They are never cancelled or refunded from this app.
- Every hour, links still unpaid after 30 minutes are checked with Razorpay, so a
  lost webhook still records the payment.
- None of this is our own SaaS billing: it only ever reads the academy's own
  integration row, never a key from the environment.

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

**Built as** (agreed 2026-09-25; `src/modules/messaging/`)

- Automatic: `fee_due` 3 days before the due date, `fee_overdue` 1 and 7 days
  after (not +3/+7/+15), `absent`, `receipt`. `welcome` and `class_cancelled`
  are sent by hand from the student and class pages (Copy, Open WhatsApp).
- Only to guardians who ticked WhatsApp messages (off until ticked, audited).
  Fees and receipts go to the family's primary guardian, absences to the
  child's; an adult who is their own contact gets no absence message.
- In the academy's time: fees at its send hour (10:00), absences at its evening
  hour (19:00), receipts at once; nothing from 21:00 to 07:00.
  `messages.remind` runs hourly, `messages.send` every minute.
- Never twice (a dedupe key per invoice and stage, child and day, payment).
  One a day per guardian and category (receipts aside) and the academy's daily
  cap (250, Meta's starting limit) move the rest to the next day.
- A waiting message is skipped once its reason is gone: invoice paid or voided,
  a payment came in, the mark changed, the payment was cancelled.
- Each message links to that invoice or receipt: a private no-login page that
  opens only on the academy's own address.
- No WhatsApp: messages wait under Messages → To send. Connected (Meta Cloud
  API, the academy's own number): a template with its approved Meta name goes
  through WhatsApp; the webhook (signature first) records delivered, read or
  failed; a failed one shows Meta's reason and can be retried.

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

**Built as** (agreed 2026-09-25; `src/modules/dashboard/`, `src/modules/reports/`)

- Dashboard: exactly four blocks (docs/06 Prompt 19). Today: classes, marked,
  not marked yet, present, and today's classes. Money: collected today and
  this month, outstanding, overdue families, new admissions, and the last 30
  days as bars (each day opens its collection sheet). At risk. Pipeline:
  follow-ups due, this month's enquiries, trials and joins, and your own
  follow-ups. A number shows only to those who may open its list.
- At risk: under 60% attendance in the last 30 days (active students), or a
  family with two or more invoices past their due date and not fully paid.
- Dues are aged by days past the due date: not yet due, 0–30, 31–60, over 60.
- Attendance % is §7's: (present + late) / (present + late + absent).
- The collection register counts receipts by the day recorded, as the
  collection sheet does. CSVs are UTF-8 with a BOM; cells Excel would run as a
  formula are defused.
- Charts are plain one-colour bars, no chart library, until after launch.
- `pnpm bench:dashboard`: 2,000 students, 30 days of marks, two months of
  invoices and payments; the dashboard took about 100 ms (limit 2 s), so no
  nightly rollup.

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

**Built as** (agreed 2026-09-26; `src/modules/portal/`, `src/modules/auth/guardian.ts`)

- On the academy's address, no navigation: the academy's name, Switch
  academy and Sign out. A child switcher when there are several children.
- A child's page in the student-profile look: the month's classes as a
  calendar (each day tinted with its mark's icon, exactly as marked), the
  Present/Late/Absent/Excused counts and the share attended; what is unpaid
  on the child's invoices, with Pay online (the invoice's private page) when
  Razorpay is connected; class timings; holidays and cancelled classes in the
  next 30 days. Notices written by the owner and leave notes come later.
- The family's receipts, each to print or save as PDF.
- Only the children linked to this guardian; another family's child,
  receipt or invoice is a 404, like one that doesn't exist. The security test
  (`src/modules/portal/portal.integration.test.ts`) was written first.

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
