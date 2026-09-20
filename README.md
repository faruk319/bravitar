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

Checks: `pnpm typecheck && pnpm lint && pnpm test`, and `pnpm test:isolation`
(tenant-leak suite, needs the database).

Gotcha: if you `pnpm migrate:down` past `0001` (which drops the app roles), the local
pooler keeps a stale role cache — `docker restart supabase_pooler_bravitar` after `pnpm migrate`.
