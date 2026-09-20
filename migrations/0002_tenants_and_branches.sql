-- up
-- docs/02-data-model.md §3. tenants is platform-owned: app_runtime may only see its
-- own row. branches is the first tenant-scoped table.

CREATE TABLE app.tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            extensions.citext UNIQUE NOT NULL,
  vertical_preset text NOT NULL DEFAULT 'general',
  timezone        text NOT NULL DEFAULT 'Asia/Kolkata',
  locale          text NOT NULL DEFAULT 'en-IN',
  currency        char(3) NOT NULL DEFAULT 'INR',
  fy_start_month  smallint NOT NULL DEFAULT 4,
  enabled_modules jsonb NOT NULL DEFAULT '{
    "students":true,"batches":true,"attendance":true,"fees":true,
    "enquiries":true,"messaging":true,"reports":true,
    "progression":false,"credits":false,"bookings":false,"pos":false
  }'::jsonb,
  label_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON app.tenants FOR ALL TO app_runtime
  USING      (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE app.branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  address     text,
  phone       text,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX branches_one_default_per_tenant
  ON app.branches (tenant_id) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX branches_tenant_idx ON app.branches (tenant_id) WHERE deleted_at IS NULL;

SELECT app.set_tenant_isolation('app.branches');

-- down
DROP TABLE IF EXISTS app.branches;
DROP TABLE IF EXISTS app.tenants;
