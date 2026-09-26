-- up
-- A plan per branch (agreed 2026-09-26): each branch has its own plan and
-- subscription, like an organisation on Supabase or a team on Vercel, and
-- plans limit students only. Existing academies move over: every branch takes
-- its academy's plan; the default branch keeps the status and trial, the
-- others start active. Only the platform role changes a subscription; the app
-- may add one, for a branch an owner adds.
CREATE TABLE app.branch_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id     uuid NOT NULL UNIQUE REFERENCES app.branches(id) ON DELETE RESTRICT,
  plan_code     text NOT NULL REFERENCES app.platform_plans(code),
  status        text NOT NULL CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz,
  period_end    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX branch_subscriptions_tenant_idx ON app.branch_subscriptions (tenant_id);
SELECT app.set_tenant_isolation('app.branch_subscriptions');
REVOKE UPDATE, DELETE ON app.branch_subscriptions FROM app_runtime;

INSERT INTO app.branch_subscriptions (tenant_id, branch_id, plan_code, status, trial_ends_at, period_end, created_at)
SELECT b.tenant_id, b.id, s.plan_code,
       CASE WHEN b.is_default THEN s.status ELSE 'active' END,
       CASE WHEN b.is_default THEN s.trial_ends_at END,
       s.period_end, s.created_at
  FROM app.branches b
  JOIN LATERAL (SELECT * FROM app.tenant_subscriptions ts WHERE ts.tenant_id = b.tenant_id ORDER BY ts.created_at DESC LIMIT 1) s ON true
 WHERE b.deleted_at IS NULL;

DROP TABLE app.tenant_subscriptions;
ALTER TABLE app.platform_plans DROP COLUMN max_staff, DROP COLUMN max_branches;

-- down
ALTER TABLE app.platform_plans ADD COLUMN max_staff integer, ADD COLUMN max_branches integer;
CREATE TABLE app.tenant_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  plan_code     text NOT NULL REFERENCES app.platform_plans(code),
  status        text NOT NULL CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz,
  period_end    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_subscriptions_tenant_idx ON app.tenant_subscriptions (tenant_id, created_at DESC);
SELECT app.set_tenant_isolation('app.tenant_subscriptions');
INSERT INTO app.tenant_subscriptions (tenant_id, plan_code, status, trial_ends_at, period_end, created_at)
SELECT bs.tenant_id, bs.plan_code, bs.status, bs.trial_ends_at, bs.period_end, bs.created_at
  FROM app.branch_subscriptions bs
  JOIN app.branches b ON b.id = bs.branch_id AND b.is_default;
DROP TABLE IF EXISTS app.branch_subscriptions;
