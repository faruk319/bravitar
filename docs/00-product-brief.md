# 00 — Product Brief

## The one-line definition

One SaaS platform where small activity academies run their students, batches,
attendance, fees and staff — each academy fully isolated from every other.

## The verticals, grouped by how they actually operate

This grouping matters more than the vertical names. It decides the whole engine.

### Group A — Roster / batch academies (V1)

Tuition classes, deeniyat / madrasa classes, karate, dance, football coaching,
music, abacus, art.

- A student **enrolls in a batch** ("Karate Batch B, Mon/Wed/Fri 6:00 PM").
- They stay in that batch for months. Nobody books individual classes.
- The teacher opens today's roster and ticks who came.
- Fees are monthly, quarterly or per-term, with installments and admission fee.
- Most payments are cash or UPI.

### Group B — Open-slot / credit academies (V2)

Gym, swimming academy, personal training, sports turf.

- A member buys **access or credits**, then books or just walks in.
- Capacity limits, waitlists, punch cards, credit burn on attendance.
- 24/7 or long-hours check-in, often via QR kiosk.
- Fees are monthly recurring, sometimes auto-debit.

### Why Group A first

1. It is five of your eight verticals with only label changes between them.
2. No capacity engine, no waitlist, no credit ledger needed at launch. That is
   roughly 40% less code before you have a paying customer.
3. These businesses run on paper registers and WhatsApp groups today. The bar
   is low and the pain is real.
4. Gym software is a crowded, price-beaten market. Enter it second, with a
   product that already works.

Group B is added by flipping `batches.enrollment_mode` from `roster` to
`booking` and turning on the credits module. The data model in `docs/02` already
supports it. Do not build it in V1.

## Users

| User | Where they log in | What they do |
|---|---|---|
| Platform admin (you) | `/platform` | Onboard tenants, set plans, support, impersonate with audit |
| Academy owner | tenant app | Everything for their academy |
| Academy staff | tenant app | Whatever their role permits |
| Teacher / coach | tenant app (mobile) | Today's roster, mark attendance, session notes |
| Parent / guardian | portal | See child's attendance, fee dues, pay, download receipt |
| Student (adult) | portal | Same, for themselves |

Guardian and student portal login is by **phone + OTP**, not email + password.
Staff login is email + password. Indian parents will not maintain an email password.

## V1 scope (must ship)

1. Tenant onboarding + branches + vertical label packs
2. Staff users, 4 preset roles, per-permission override, owner bypass
3. Students, households, guardians, consent capture
4. Programs, batches, recurring schedules, auto-generated sessions
5. Enrollments (join batch, pause, transfer batch, leave)
6. Attendance against the roster, mobile-first, works offline for one session
7. Fee plans, invoices, installments, discounts, waivers
8. Payment ledger: cash, UPI manual, bank transfer, cheque, Razorpay payment link
9. Receipts + gapless numbering per tenant per financial year
10. WhatsApp: fee reminder, receipt, absence alert, holiday notice
11. Enquiry → trial → conversion tracking
12. Owner dashboard: today's attendance, this month's collection, pending dues,
    students at risk of dropping out
13. Audit log
14. Platform admin: create tenant, set plan and limits, suspend

## V1 explicit non-goals

Write these on a wall. Every one of them is a month you don't spend.

- Gym / swimming / booking / waitlist / punch cards → V2
- Exams, marksheets, report cards, GPA → never (this is not a school system)
- Social feed, leaderboards, peer comments → never
- Embeddable public calendar widget for tenant websites → V3
- Biometric, RFID, turnstile, face recognition → V3 at earliest
- POS, retail, inventory → V3
- Native Android/iOS apps → PWA only
- Razorpay auto-debit / e-mandate subscriptions → V2, optional
- Tally / Zoho Books integration → V3
- Multi-currency → never, until you have a customer outside India
- Custom role builder with unlimited roles → V2
- Tenant custom domains → V3 (subdomain is enough)

## Pilot strategy (do this before writing code)

Find **three real academies near you** now. A karate class, a tuition centre and a
deeniyat class is the ideal mix, because their differences will expose your wrong
assumptions early.

Offer: free for 12 months, in exchange for 30 minutes of feedback every week and
permission to use them as a reference customer.

If you cannot find three academies willing to take free software, that is the most
valuable signal you will get all year, and it costs you nothing to learn it now
instead of after six months of building.

Ask each of them, before you build:

1. Show me your current fee register. Photograph it.
2. Show me your attendance register. Photograph it.
3. What happens when a student pays half the fee?
4. What discount do you give for a second child?
5. How do you chase a parent who hasn't paid for two months?
6. What do you do when a student wants to shift from the 6 PM to the 7 PM batch?
7. How many students do you lose per month, and do you know why?

Your data model is either right or wrong based on those seven answers. Everything
in `docs/02-data-model.md` is my best guess at them. Correct it with real answers.

## Naming

Pick a neutral, professional name like you did for the print platform. Avoid
"academy" in the name if you want to sell to gyms later. Check `.com` and the
Indian trademark register before printing anything.

## Relationship to your print/job-tracking platform

The tenant, RBAC, subscription-tier, super-admin, WhatsApp and audit-log patterns
are close to identical across both products. Reuse the **approach and the code by
copying**, not by building a shared framework library. Abstracting across two
products that neither has a live customer yet is how solo projects stall.
