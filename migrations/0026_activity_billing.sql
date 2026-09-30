-- up
-- Bravitar's own billing (agreed 2026-09-30): each activity in each branch has
-- its own subscription, bills and pause. Replaces the plan per branch (0025).
-- Only the platform role writes these tables; academies read their own rows.

-- The catalog. PLACEHOLDER prices, changed in /platform/activities.
CREATE TABLE app.activities (
  key              text PRIMARY KEY,
  name             text NOT NULL,
  description      text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','coming_soon','retired')),
  price_paise      bigint NOT NULL CHECK (price_paise >= 0),
  billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
REVOKE INSERT, UPDATE, DELETE ON app.activities FROM app_runtime;

-- The keys match tenants.vertical_preset; gym and swimming wait for booking.
INSERT INTO app.activities (key, name, description, status, price_paise) VALUES
  ('tuition',  'Tuition',         'Tuition and coaching classes',       'active',      30000),
  ('deeniyat', 'Deeniyat',        'Madrasa and maktab classes',         'active',      0),
  ('karate',   'Karate',          'Karate and martial arts',            'active',      30000),
  ('dance',    'Dance',           'Dance classes',                      'active',      30000),
  ('sports',   'Sports coaching', 'Football, cricket and other sports', 'active',      30000),
  ('general',  'Other activity',  'Any other classes',                  'active',      30000),
  ('gym',      'Gym',             'Memberships and check-ins',          'coming_soon', 30000),
  ('swimming', 'Swimming',        'Slots and swim levels',              'coming_soon', 50000);

CREATE TABLE app.activity_price_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_key text NOT NULL REFERENCES app.activities(key),
  old_paise    bigint NOT NULL,
  new_paise    bigint NOT NULL,
  reason       text,
  changed_by   uuid REFERENCES app.platform_admins(id),
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_price_history_key_idx ON app.activity_price_history (activity_key, changed_at DESC);
REVOKE ALL ON app.activity_price_history FROM app_runtime;

-- One row. Tax is in basis points (1800 = 18%), 0 until there is a GSTIN.
CREATE TABLE app.billing_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  grace_days  smallint NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
  trial_days  smallint NOT NULL DEFAULT 30 CHECK (trial_days BETWEEN 0 AND 365),
  tax_rate_bp integer NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  gstin       text,
  how_to_pay  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app.billing_settings DEFAULT VALUES;
REVOKE INSERT, UPDATE, DELETE ON app.billing_settings FROM app_runtime;

-- One per activity in a branch; a cancelled one stays and a new one starts if
-- it comes back. period_end is the next bill date (the trial's end on trial).
-- The price is agreed when it starts; the override is free use or a special
-- price, until a date or for good.
CREATE TABLE app.activity_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id            uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  activity_key         text NOT NULL REFERENCES app.activities(key),
  status               text NOT NULL CHECK (status IN ('trial','active','paused','cancelled')),
  price_paise          bigint NOT NULL CHECK (price_paise >= 0),
  override_paise       bigint CHECK (override_paise >= 0),
  override_until       date,
  override_reason      text,
  anchor_day           smallint NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  activated_at         timestamptz NOT NULL DEFAULT now(),
  paused_at            timestamptz,
  cancelled_at         timestamptz,
  CHECK (period_end >= period_start),
  CHECK (override_paise IS NOT NULL OR (override_until IS NULL AND override_reason IS NULL))
);
CREATE UNIQUE INDEX activity_subscriptions_live_uq ON app.activity_subscriptions (branch_id, activity_key) WHERE status <> 'cancelled';
CREATE INDEX activity_subscriptions_tenant_idx ON app.activity_subscriptions (tenant_id);
CREATE INDEX activity_subscriptions_due_idx ON app.activity_subscriptions (period_end) WHERE status <> 'cancelled';
SELECT app.set_tenant_isolation('app.activity_subscriptions');
REVOKE INSERT, UPDATE, DELETE ON app.activity_subscriptions FROM app_runtime;

-- A program is one activity; its batches follow it.
ALTER TABLE app.programs ADD COLUMN activity_key text REFERENCES app.activities(key);
UPDATE app.programs p SET activity_key = t.vertical_preset FROM app.tenants t WHERE t.id = p.tenant_id;
ALTER TABLE app.programs ALTER COLUMN activity_key SET NOT NULL;

-- Existing academies move over: each branch takes its academy's type as its
-- activity. A trial keeps its end date; the rest are billed from today.
INSERT INTO app.activity_subscriptions (tenant_id, branch_id, activity_key, status, price_paise, anchor_day, period_start, period_end, activated_at, paused_at, cancelled_at)
SELECT b.tenant_id, b.id, t.vertical_preset, s.status, a.price_paise, extract(day FROM s.period_end)::smallint,
       least(s.period_start, s.period_end), s.period_end, coalesce(bs.created_at, now()),
       CASE WHEN s.status = 'paused' THEN now() END,
       CASE WHEN s.status = 'cancelled' THEN now() END
  FROM app.branches b
  JOIN app.tenants t ON t.id = b.tenant_id AND t.deleted_at IS NULL
  JOIN app.activities a ON a.key = t.vertical_preset
  LEFT JOIN app.branch_subscriptions bs ON bs.branch_id = b.id
 CROSS JOIN LATERAL (
   SELECT CASE bs.status WHEN 'trial' THEN 'trial' WHEN 'suspended' THEN 'paused' WHEN 'cancelled' THEN 'cancelled' ELSE 'active' END AS status,
          CASE WHEN bs.status = 'trial' THEN (bs.created_at AT TIME ZONE t.timezone)::date ELSE (now() AT TIME ZONE t.timezone)::date END AS period_start,
          CASE WHEN bs.status = 'trial' AND bs.trial_ends_at IS NOT NULL THEN (bs.trial_ends_at AT TIME ZONE t.timezone)::date ELSE (now() AT TIME ZONE t.timezone)::date END AS period_end
 ) s
 WHERE b.deleted_at IS NULL;

DROP TABLE app.branch_subscriptions;
DROP TABLE app.platform_plans;

-- The billing permissions, so a role can be given them before the next sync.
INSERT INTO app.permissions (key, module, description) VALUES
  ('billing:view', 'core', 'See Bravitar''s bills for this academy'),
  ('billing:manage', 'core', 'Turn activities on or off in a branch')
ON CONFLICT (key) DO NOTHING;

-- down
DELETE FROM app.role_permissions WHERE permission_key IN ('billing:view', 'billing:manage');
DELETE FROM app.permissions WHERE key IN ('billing:view', 'billing:manage');

CREATE TABLE app.platform_plans (
  code             text PRIMARY KEY,
  name             text NOT NULL,
  price_paise      bigint NOT NULL,
  billing_cycle    text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  max_students     integer,
  included_modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active        boolean NOT NULL DEFAULT true
);
REVOKE INSERT, UPDATE, DELETE ON app.platform_plans FROM app_runtime;
INSERT INTO app.platform_plans (code, name, price_paise, billing_cycle, max_students) VALUES
  ('starter', 'Starter', 99900, 'monthly', 100),
  ('growth', 'Growth', 199900, 'monthly', 300),
  ('pro', 'Pro', 399900, 'monthly', NULL);

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
INSERT INTO app.branch_subscriptions (tenant_id, branch_id, plan_code, status, trial_ends_at, created_at)
SELECT DISTINCT ON (s.branch_id) s.tenant_id, s.branch_id, 'starter',
       CASE s.status WHEN 'paused' THEN 'suspended' ELSE s.status END,
       CASE WHEN s.status = 'trial' THEN s.period_end::timestamptz END,
       s.activated_at
  FROM app.activity_subscriptions s
 ORDER BY s.branch_id, (s.status = 'cancelled'), s.activated_at;

ALTER TABLE app.programs DROP COLUMN activity_key;
DROP TABLE app.activity_subscriptions;
DROP TABLE app.billing_settings;
DROP TABLE app.activity_price_history;
DROP TABLE app.activities;
