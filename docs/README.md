# Multi-Tenant Academy SaaS — specification bundle

Drop these into a fresh git repository and start with Claude Code.

```
CLAUDE.md                         # read automatically at the start of every Claude Code session
docs/00-product-brief.md          # what it is, V1 scope, what NOT to build, pilot strategy
docs/01-architecture.md           # tenancy, RLS, auth, permissions, jobs, money, compliance
docs/02-data-model.md             # complete V1 PostgreSQL DDL
docs/03-module-specs.md           # module behaviour + acceptance criteria
docs/04-fees-and-payments.md      # fee plans, invoicing, collection, numbering, Razorpay phasing
docs/05-build-plan.md             # phased slices, scope discipline, realistic timeline
docs/06-claude-code-prompts.md    # copy-paste prompts, review audits, anti-patterns
docs/07-ui-ux.md                  # design tokens, three shells, component rules, wireframes
```

## Read in this order

1. `docs/00-product-brief.md` — check you agree with the V1 scope call before anything else
2. `docs/05-build-plan.md` — see the shape of the work
3. `docs/06-claude-code-prompts.md` — Prompt 0 starts the build

## Before writing code

Talk to three real academies. `docs/00-product-brief.md` has the seven questions
to ask them. The data model in `docs/02-data-model.md` is a good guess at their
answers; their actual answers are worth more than any of it.

## The two rules that matter most

1. **Tenant isolation comes first**, with a test that fails when a policy is
   missing. One leak between two academies ends the business.
2. **Money tests come before money code.** A wrong invoice in front of a pilot
   academy costs that customer permanently.

## Decisions already baked in

- V1 covers roster academies only: tuition, deeniyat, karate, dance, football.
  Gym and swimming are V2, and they are additive rather than a rewrite.
- Payments start as a ledger (cash, UPI, bank, cheque). Razorpay Payment Links
  come in V1.5. Auto-debit subscriptions are V2 and optional.
- Each academy connects their own Razorpay and WhatsApp accounts. Their money
  never passes through yours.
- Supabase is used as **managed Postgres and Storage only**. Not its Auth, not
  Realtime, not Edge Functions, not the auto-generated API. The app connects as a
  restricted `app_runtime` role; the `service_role` key never reaches app code.
  Everything stays plain PostgreSQL, so leaving later is a `pg_dump`.
- The app and the pg-boss worker run on one small VPS, because a background
  worker needs a long-running process.
