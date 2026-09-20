# 07 — UI, UX and Wireframes

Decisions locked: **phone-first for staff**, **monochrome plus one accent**,
**English only at launch**.

This is a work tool used every evening by a karate coach standing in a hall with
30 children waiting. It is not a portfolio piece. Every rule below follows from
that one sentence.

---

## 1. Three shells, one design system

This product is three different experiences sharing one component library. Do not
force them into one layout.

| Shell | Who | Device | Navigation |
|---|---|---|---|
| **Coach shell** | Teacher, coach | Phone | Bottom nav, 3 items |
| **Admin shell** | Owner, manager, front desk | Phone and laptop | Icon rail that expands; bottom sheet on phone |
| **Portal shell** | Parent, adult student | Phone browser | No nav at all. One scrolling page |

Routing picks the shell from the logged-in role, not from the screen width.
A coach on a laptop still gets the coach shell — bigger, same structure.

---

## 2. Design tokens

### Colour

Neutrals do ninety percent of the work. There is **one** accent, and it means
one thing: "this is the action, or this is where you are."

```
neutral-0    #FFFFFF   page background (light)
neutral-50   #F7F7F6   card / hover background
neutral-100  #EDEDEA   dividers, disabled fills
neutral-300  #C9C9C4   borders
neutral-500  #77776F   secondary text
neutral-700  #464642   body text
neutral-900  #1A1A18   headings, primary buttons

accent-600   #2B5FD9   primary button, active nav, links
accent-50    #EEF3FD   active nav background, selected row
```

Status colours are a **separate system** from the accent. They never appear on
buttons or navigation, only on data.

```
success-600  #1F7A46   present, paid
danger-600   #C1392B                absent, overdue
warning-600  #A9640A                unmarked, due soon
```

Rules:

- A screen has **at most one** accent-filled button. Everything else is outline
  or plain text.
- Never use colour alone to carry meaning. Present and absent get an icon and a
  word, not just green and red. Roughly one in twelve Indian men is colour
  deficient, and a coach who marks the wrong child once stops trusting the app.
- Minimum contrast 4.5:1 for text. Test the overdue number against tube light,
  not against your monitor at night.
- Dark mode: ship it, but after V1. Tokens are named so it is a token-file swap.

### Type

Inter, with the system stack as fallback. English only, so one family is enough.
When Hindi and Marathi arrive, Noto Sans Devanagari pairs with Inter cleanly and
Devanagari needs about 15% more line-height — leave that room in the type scale
now rather than re-tuning every screen later.

```
display   24px / 500 / 1.3    screen titles
heading   18px / 500 / 1.4    card titles, section heads
body      16px / 400 / 1.5    default. Never smaller for anything a user reads
label     14px / 500 / 1.4    field labels, table headers
caption   13px / 400 / 1.4    timestamps, helper text
number    20px / 500 / 1.2    tabular-nums, for money and counts
```

Two weights only: 400 and 500. No 600, no 700, no italics.

**16px body is a hard floor on mobile.** Anything below 16px in an input makes
iOS Safari zoom on focus, and your form jumps around.

### Spacing, size, shape

```
space     4 / 8 / 12 / 16 / 24 / 32 / 48
radius    8px everywhere. 12px on cards. Nothing else.
border    1px solid neutral-300. No shadows except on sheets and popovers.
```

**Tap targets: 48px minimum, 56px for anything tapped repeatedly.** The
attendance row is 56px. Buttons are 48px. Nothing is 32px on a phone.

### Money and numbers

- Indian grouping, always: **₹1,42,500** — not ₹142,500.
- `font-variant-numeric: tabular-nums` on every number, so columns line up.
- Never show paise in the UI unless a value actually has them.
- Amounts are right-aligned in tables, left-aligned in cards.

Write one `<Money>` component and one `<Count>` component on day one. Any
`toLocaleString` call outside those two is a bug.

---

## 3. Coach shell (phone) — the most important screen in the product

The coach opens the app, marks attendance, closes it. Target: **under 15 seconds,
three taps, and it works with no signal.**

### Bottom nav — three items only

```
┌──────────────────────────────┐
│                              │
│        (screen content)      │
│                              │
├──────────────────────────────┤
│   Today      Students    Me  │   56px, icon + label
└──────────────────────────────┘
```

Not five items. Not a hamburger. A coach has exactly one job in this app.

### Rules for the coach shell

- Primary action sits in the **bottom third** of the screen, thumb reachable.
  The "Save" button is fixed above the nav bar, not at the top right.
- Every list row is tappable across its full width, not just a small icon.
- No horizontal scrolling. No tables. Cards and rows only.
- Offline banner is persistent and plain: `Offline — 12 marks will sync`.
  Never a toast that disappears before it is read.
- No confirmation dialogs for attendance. Marking is instantly undoable instead.
- One screen, one job. If a screen needs a scroll to find its main action, it is
  two screens.

---

## 4. Admin shell — icon rail that expands

Desktop: 64px icon rail always visible, expands to 260px panel on click, state
remembered. Phone: the rail becomes a bottom sheet triggered from the header.

Navigation grouped into four sections, in this order. This order is the owner's
actual day.

```
DAILY          Dashboard, Today's sessions, Attendance
PEOPLE         Students, Enquiries, Staff
MONEY          Invoices, Collect payment, Reports
SETUP          Programs & batches, Fee plans, Messages, Settings
```

Badge counts on nav items are the cheapest useful feature in the product:
`Enquiries 6`, `Invoices 14`. Put them in from the start.

`⌘K` search across students, guardians, phone numbers and invoice numbers. Front
desk staff will use this more than any menu.

---

## 5. Portal shell (parent)

No navigation. One scrolling page per child, with a child switcher at the top if
there is more than one. A parent opens this maybe twice a month; they should
never have to learn anything.

---

## 6. Component rules

**Empty states.** Every list needs one, because a brand new academy has zero of
everything. Each empty state has a one-line explanation and one button that
creates the first item. Never a blank screen with "No data".

**Loading.** Skeleton rows matching the real layout, never a spinner over the
whole page. The list shape should appear instantly even if the data takes a
second on 3G.

**Errors.** Inline, next to the field, in plain words. "Phone number already
belongs to Sana Shaikh" beats "Validation failed".

**Destructive actions.** Type-to-confirm only for deleting a student or voiding
an invoice. Everything else is undo-based.

**Forms.** One column, always. Labels above fields, never beside. Phone keypad
for phone fields (`inputmode="tel"`), numeric for amounts. Autofocus the first
field. Submit button never above the fold on mobile.

**Tables.** Desktop only. On phone a table becomes a card list. Never let a
table scroll sideways on a phone.

---

## 7. Wireframes

Low fidelity on purpose. Boxes and labels, no styling decisions. Build these
first, make them pretty later.

### 7.1 Coach — Today

```
┌────────────────────────────────────┐
│ Today                    Fri 19 Sep│
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ Beginners · Batch B            │ │
│ │ 6:00 PM · Hall 1 · 30 students │ │
│ │ ● Not marked                   │ │  ← status dot + word
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ Advanced · Batch A             │ │
│ │ 7:15 PM · Hall 1 · 18 students │ │
│ │ ● Not marked                   │ │
│ └────────────────────────────────┘ │
│                                    │
│  (no more sessions today)          │
├────────────────────────────────────┤
│  Today      Students          Me   │
└────────────────────────────────────┘
```

If there is exactly one session today, **skip this screen** and open the roster
directly. Most coaches have one.

### 7.2 Coach — Roster (the 15-second screen)

```
┌────────────────────────────────────┐
│ ←  Beginners · Batch B             │
│    Fri 19 Sep · 6:00 PM            │
├────────────────────────────────────┤
│ [ Mark all present ]   26/30       │  ← one tap, then fix exceptions
├────────────────────────────────────┤
│ Aarav Deshmukh            ✓ Present│  56px row, full width tappable
│ Zoya Shaikh               ✗ Absent │
│ Ishaan Patil  [trial]     ✓ Present│
│ Meher Kaur                ○ —      │  ← unmarked, NOT absent
│ …                                  │
├────────────────────────────────────┤
│  Offline — will sync               │  ← only when offline
│ [        Save attendance         ] │  ← fixed, thumb zone
└────────────────────────────────────┘
```

Tapping a row cycles Present → Absent → Late. Long press opens a note field.

### 7.3 Coach — Student quick view

```
┌────────────────────────────────────┐
│ ←  Aarav Deshmukh                  │
├────────────────────────────────────┤
│ Beginners · Batch B                │
│ Joined 12 Mar 2026                 │
├────────────────────────────────────┤
│ Attendance (30 days)      87%      │
│ ▓▓▓▓▓▓▓▓░░                         │
├────────────────────────────────────┤
│ Guardian                           │
│ Rakesh Deshmukh                    │
│ [ Call ]        [ WhatsApp ]       │
└────────────────────────────────────┘
```

A coach sees attendance and the guardian's number. **No fee information.** That
is a permission boundary, and it is also basic courtesy to the family.

### 7.4 Front desk — Collect payment

```
┌────────────────────────────────────┐
│ ←  Collect payment                 │
├────────────────────────────────────┤
│ Family                             │
│ [ Deshmukh family            🔍 ]  │
├────────────────────────────────────┤
│ Outstanding                        │
│ ☑ INV/2026-27/0042   ₹1,500        │
│ ☐ INV/2026-27/0061   ₹1,500        │
│                                    │
│ Selected                 ₹1,500    │
├────────────────────────────────────┤
│ Amount received                    │
│ [ ₹ 1,500                       ]  │  numeric keypad
│                                    │
│ Method                             │
│ ( Cash ) ( UPI ) ( Bank ) ( Cheque)│
│                                    │
│ Reference (optional)               │
│ [                               ]  │
├────────────────────────────────────┤
│ [    Record payment & print      ] │
└────────────────────────────────────┘
```

After saving, go straight to the receipt with one button: **Send on WhatsApp**.
Do not return to a list. The next thing that happens in real life is the parent
asking for the receipt.

### 7.5 Owner — Dashboard (desktop)

```
┌──────┬──────────────────────────────────────────────────────┐
│ ▤    │ Dashboard                          Sept 2026    ⌘K   │
│      ├──────────────────────────────────────────────────────┤
│ DAILY│ ┌─────────┬─────────┬─────────┬─────────┐            │
│  ▪   │ │ Present │Collected│ Outstan.│ New adm.│            │
│  ▪   │ │ 86/104  │₹1,42,500│ ₹38,000 │    9    │            │
│      │ └─────────┴─────────┴─────────┴─────────┘            │
│PEOPLE│  every number links to the list behind it            │
│  ▪ 6 │                                                      │
│  ▪   │ ┌──────────────────────────────────────────────────┐ │
│      │ │ Needs attention                                  │ │
│ MONEY│ │ ⚠ 14 families overdue 15+ days      → Remind     │ │
│  ▪14 │ │ ⚠ 3 batches not marked today        → View       │ │
│  ▪   │ │ ⚠ 6 students at risk                → View       │ │
│      │ └──────────────────────────────────────────────────┘ │
│ SETUP│ ┌────────────────────────┬─────────────────────────┐ │
│  ▪   │ │ Collection, last 30 d  │ Today's sessions        │ │
│  ▪   │ │ (single-colour bars)   │ (list with status)      │ │
└──────┴────────────────────────────────────────────────────── ┘
```

Four numbers, one attention list, two panels. That is the whole dashboard.
No widget picker, no drag and drop, no arranging. The owner wants the same four
numbers in the same place every single day.

### 7.6 Owner — Students list (desktop)

```
┌──────────────────────────────────────────────────────────┐
│ Students                            [ + Add student ]    │
├──────────────────────────────────────────────────────────┤
│ [Search 🔍] [Batch ▾] [Status ▾] [Dues ▾]      142 shown │
├──────────────────────────────────────────────────────────┤
│ NAME            CODE        BATCH        ATTEND    DUES  │
│ Aarav Deshmukh  ABC/26/0142 Beginners B    87%       —   │
│ Zoya Shaikh     ABC/26/0143 Beginners B    54%   ₹3,000  │
│ Meher Kaur      ABC/26/0144 Advanced A     92%       —   │
└──────────────────────────────────────────────────────────┘
```

On phone this exact list becomes stacked cards: name, batch, then attendance and
dues as two small labels. Same data, different container, no horizontal scroll.

### 7.7 Owner — Student profile

Tabs: **Overview · Attendance · Fees · Notes**. Header holds the actions that are
actually used: Collect payment, WhatsApp, Edit.

```
┌──────────────────────────────────────────────────────────┐
│ Aarav Deshmukh  ABC/26/0142   [Collect] [WhatsApp] [Edit]│
│ Beginners · Batch B · Active · Joined 12 Mar 2026        │
├──────────────────────────────────────────────────────────┤
│ Overview │ Attendance │ Fees │ Notes                     │
├──────────────────────────────────────────────────────────┤
│ Attendance 30d  87%        Outstanding        —          │
│ Family: Deshmukh (2 students)                            │
│ Guardian: Rakesh Deshmukh · +91 ·····                    │
│ Siblings: Anaya Deshmukh (Advanced A)                    │
└──────────────────────────────────────────────────────────┘
```

Siblings on the overview matters. When a parent calls, front desk needs the whole
family on one screen, not two searches.

### 7.8 Parent portal

```
┌────────────────────────────────────┐
│ Shaolin Karate Academy             │
│ [ Aarav ▾ ]        ← child switcher│
├────────────────────────────────────┤
│ Attendance this month     18 / 21  │
│ ▓▓▓▓▓▓▓▓▓░                         │
├────────────────────────────────────┤
│ Fees                               │
│ Nothing pending ✓                  │
│ [ View receipts ]                  │
├────────────────────────────────────┤
│ Class timings                      │
│ Mon · Wed · Fri   6:00 – 7:00 PM   │
├────────────────────────────────────┤
│ Notices                            │
│ 2 Oct — holiday, no class          │
└────────────────────────────────────┘
```

Read only. Four blocks. A parent must never need to be taught how to use this.

### 7.9 Auth

```
Staff                          Guardian
┌──────────────────┐           ┌──────────────────┐
│ Sign in          │           │ Enter your phone │
│ [ email       ]  │           │ [ +91 ········ ] │
│ [ password    ]  │           │ [ Send code    ] │
│ [ Sign in     ]  │           │                  │
│ Forgot password  │           │ code arrives on  │
└──────────────────┘           │ WhatsApp         │
                               └──────────────────┘
```

---

## 8. Build order for the UI

1. Tokens and the primitives: Button, Input, Select, Card, Row, Sheet, Money, Count
2. Coach shell and the roster screen, on a real phone, before anything else
3. Admin shell with the four nav groups
4. List and table patterns, with their empty states
5. Forms
6. Portal shell last — it is the simplest and reuses everything

Test every screen on a real mid-range Android phone over 3G, not on a desktop
browser narrowed to 390px. They are not the same thing, and the difference is
where this product wins or loses.

---

## 9. Things not to build

Drag-and-drop dashboard widgets. A theme picker. Animated page transitions.
Glassmorphism, gradients, neumorphic shadows. A custom icon set — use Lucide.
Charts with more than one colour. Onboarding tours. A chatbot in the corner.
Confetti.

Every one of these costs a week and none of them gets a fee paid on time.
