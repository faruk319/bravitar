# Bravitar

Multi-tenant SaaS for Indian activity academies: students, batches, attendance,
fees and staff. Specs live in [`docs/`](docs/README.md); working rules in
[`CLAUDE.md`](CLAUDE.md).

## Run it

Needs Node 22+, pnpm 10, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
cp .env.example .env
pnpm install
pnpm db:up        # local Supabase stack in Docker (Postgres + pooler + storage)
pnpm migrate      # apply migrations/*.sql
pnpm dev          # http://localhost:3000
```

Log in locally at `http://shivaji-karate.localhost:3000` or `http://bright-future.localhost:3000`
(owner `owner@<slug>.demo`, coach `coach@shivaji-karate.demo` / `teacher@bright-future.demo`,
password `Demo@1234`). Or with curl:

```bash
curl -i -X POST http://localhost:3000/api/auth/login -H 'Host: shivaji-karate.localhost:3000' \
  -H 'content-type: application/json' -d '{"email":"owner@shivaji-karate.demo","password":"Demo@1234"}'
```

Checks: `pnpm typecheck && pnpm lint && pnpm test`, and `pnpm test:isolation`
(tenant-leak suite, needs the database).

## Folder structure

Next.js App Router with a `src` folder. `app/` holds routes only; all other code lives outside it
(the "store project files outside of `app`" strategy in the
[Next.js docs](https://nextjs.org/docs/app/getting-started/project-structure)). Business code is
split by feature, the way NestJS does it.

```
migrations/            numbered SQL files, append-only, each with -- up and -- down
supabase/              the local Supabase stack (pnpm db:up)
docs/                  specs: read the one for your area first
public/                static files
src/
  app/                 routes only
    (tenant)/          academy staff, on <slug>.<domain>
    (portal)/          parents and adult students
    (platform)/        Bravitar's super admin at /platform
    (auth)/            login and invites
    (public)/          private links that need no login (/i, /r)
    api/**/route.ts    endpoints; each re-exports a handler from src/modules/<feature>/routes.ts
  modules/<feature>/   one folder per business feature
    schema.ts          Drizzle tables
    repo.ts            every query
    service.ts         business rules and zod input schemas
    routes.ts          HTTP handlers
    job.ts             background jobs, run by src/worker.ts (only if it has any)
    isolation.ts       fixtures for the tenant-leak suite
    *.integration.test.ts
  components/          React UI: ui/ is shadcn, the rest follows the modules
  lib/                 shared code: db, auth, money, dates, jobs, crypto, tenant…
  proxy.ts             sends signed-out visitors to /login (Next.js proxy)
  instrumentation.ts   safety checks when the server starts
  worker.ts            background jobs: pnpm worker
```

### Coming from NestJS

| NestJS | Here |
|---|---|
| Module | `src/modules/<feature>/` |
| Controller | `routes.ts`, given its URL by `src/app/api/**/route.ts` |
| Service | `service.ts` |
| Repository | `repo.ts` |
| Entity | `schema.ts` |
| DTO and validation pipe | the zod schemas in `service.ts` |
| Guard | `assertCan()` in the service, plus Postgres row-level security |

### Adding a feature

One vertical slice: migration → `schema.ts` → `repo.ts` → `service.ts` → `routes.ts` and its
`src/app/api/.../route.ts` → the page in `src/app/` → tests. Every new academy table also gets an
`isolation.ts` fixture.

### Karate, Swimming, Deeniyat…

These are the modules Bravitar sells, called activities in code; the list is
`src/lib/activities.ts`. They have no folders of their own yet because they share every feature
(students, batches, attendance, fees…). Only data differs: names, plans, prices and labels.

A folder comes with the first feature that belongs to an activity:
- used by one activity only: `src/modules/<activity>/`, for example `swimming/` for lanes;
- shared by several: named after the feature, for example one `progression/` for karate belts,
  dance levels and swimming skills.

Then mark that feature ready in `src/lib/activities.ts`.

Gotcha: if you `pnpm migrate:down` past `0001` (which drops the app roles), the local
pooler keeps a stale role cache — `docker restart supabase_pooler_bravitar` after `pnpm migrate`.
