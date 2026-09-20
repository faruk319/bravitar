# CLAUDE.md — Bravitar

> Next.js 16 conventions differ from older training data: see `AGENTS.md` (kept current by `next dev`).
> This file is read at the start of every Claude Code session. Keep it under ~200 lines.
> Detailed specs live in `docs/`. Do not duplicate them here.

## What this is

A multi-tenant SaaS for Indian activity academies: tuition classes, deeniyat/madrasa
classes, karate, dance, football coaching, and later gyms and swimming academies.

Each tenant is one academy business. Tenants must never see each other's data.

Read `docs/00-product-brief.md` before your first task in a new area.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript, strict mode, no `any` |
| App | Next.js (App Router), one full-stack codebase |
| DB | PostgreSQL on **Supabase** (managed), Row-Level Security enabled |
| DB access | App connects as a custom `app_runtime` role. **Never** the `service_role` key |
| ORM | Drizzle ORM, plain SQL migrations |
| Auth | Custom session cookies (argon2id), sessions stored in Postgres |
| Jobs | pg-boss (Postgres-backed queue, no Redis) |
| UI | React + Tailwind + shadcn/ui + Lucide icons. Phone-first. See `docs/07-ui-ux.md` |
| Files | Supabase Storage behind a `StorageAdapter` interface (S3-swappable) |
| Payments | Razorpay, per-tenant credentials |
| Messaging | WhatsApp Business API behind a `MessagingAdapter` interface |
| Tests | Vitest (unit + integration), Playwright later |

## Folder structure

```
src/
  app/                      # Next.js routes
    (platform)/             # super-admin area
    (tenant)/               # academy staff area
    (portal)/               # parent/student portal
    api/
  modules/                  # one folder per business module
    <module>/
      schema.ts             # Drizzle table definitions
      repo.ts               # data access, all queries live here
      service.ts            # business logic
      routes.ts             # HTTP handlers
      <module>.test.ts
  lib/
    db/                     # connection, RLS session helper, migrations runner
    auth/
    money/                  # paise helpers, never floats
    tenant/                 # tenant context resolution
  components/
docs/                       # specs — read these, don't guess
migrations/                 # numbered .sql files, append-only
```

## Non-negotiable rules

1. **Tenant isolation.** Every tenant-scoped table has `tenant_id uuid not null`,
   RLS enabled and `FORCE ROW LEVEL SECURITY`. The app connects as a non-owner
   role. Every request opens a transaction and runs
   `SET LOCAL app.tenant_id = '<uuid>'` before any query. Never build a query that
   relies on the caller remembering to filter by tenant.
2. **Every new tenant-scoped table ships with an isolation test** in the same PR,
   proving tenant A cannot read or write tenant B's rows. No exceptions.
3. **Money is `bigint` paise.** Never float, never `numeric` in application code,
   never a rupee string. Format only at the UI edge. See `src/lib/money/`.
4. **Timestamps are `timestamptz`, stored UTC.** Each tenant has a timezone
   (default `Asia/Kolkata`). Convert only for display and for "what day is this
   session on" logic.
5. **Migrations are append-only.** Never edit an applied migration. One migration
   per change, numbered, with a `-- down` section.
6. **IDs are UUIDv7**, generated in the application, so index locality is sane.
7. **Soft delete, don't hard delete** anything touching people, money or attendance.
   `deleted_at timestamptz`.
8. **Audit log** every write to money, attendance, enrollment status, roles and
   integration credentials.
9. **Secrets are encrypted at rest.** Per-tenant Razorpay and WhatsApp credentials
   go through `src/lib/crypto` with an app-level key. Never log them.
10. **All webhooks are idempotent.** Store the provider event id, ignore duplicates.
11. **Supabase is used as managed Postgres and Storage only.** Do not use Supabase
    Auth, Realtime, Edge Functions, or the auto-generated PostgREST API. Our auth,
    our API, our migrations. If you are about to `import { createClient } from
    '@supabase/supabase-js'` for anything except a signed storage URL, stop and ask.
12. **The `service_role` key bypasses RLS and must never reach application code.**
    It lives in the migration runner's environment only. Every app query goes
    through the `app_runtime` connection string. Tables live in the `app` schema,
    which is not exposed through Supabase's API settings.

## Working agreement

- Start non-trivial work in plan mode. Show me the plan before writing files.
- **One vertical slice per task**: migration → repo → service → route → UI → test.
- Do not create more than ~6 files in one turn without stopping for review.
- If a spec in `docs/` is ambiguous, stop and ask. Do not invent business rules,
  especially around fees, discounts, refunds or attendance.
- Do not add a dependency without saying why in one line first.
- After each task: run `pnpm typecheck && pnpm test` and report the result honestly.
  A failing test reported as passing is the worst outcome possible here.

## Definition of done

- [ ] Types check, lint clean, tests pass
- [ ] Tenant isolation test added for any new tenant-scoped table
- [ ] Migration has an applied `-- up` and a working `-- down`
- [ ] Permission check on every new API route (`module:action`)
- [ ] Feature-flag check if the route belongs to an optional module
- [ ] Audit log entry if the action touches money, attendance or roles
- [ ] Seed data updated so the new feature is visible in `pnpm seed`

## Do not build (ask me first)

Microservices. A second database. GraphQL. A custom no-code form builder.
A social feed or leaderboard. Native mobile apps. Biometric or RFID integration.
POS/inventory. Schema-per-tenant. Your own payment wallet or escrow.
An unlimited custom-role builder (V1 has 4 preset roles + per-permission override).

## Commands

```bash
pnpm dev          # local dev
pnpm db:up        # local Supabase stack in Docker via the CLI (Postgres + pooler + storage); dev + tests
pnpm db:down      # stop it
pnpm migrate      # apply migrations/*.sql (owner role); migrate:down reverts the last one
pnpm seed         # demo tenant: 1 karate academy, 1 tuition centre
pnpm typecheck
pnpm lint
pnpm test
pnpm test:isolation   # tenant leak suite — must always pass
```
