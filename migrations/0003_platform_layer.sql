-- up
-- docs/02-data-model.md §2 (platform layer), §7 (resources), §11 (audit_log).

-- What the ACADEMY pays US. Read-only reference data for tenants; the platform
-- role (super-admin panel) edits it. No tenant_id, so no tenant policy.
CREATE TABLE app.platform_plans (
  code             text PRIMARY KEY,
  name             text NOT NULL,
  price_paise      bigint NOT NULL,
  billing_cycle    text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  max_students     integer,
  max_staff        integer,
  max_branches     integer,
  included_modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active        boolean NOT NULL DEFAULT true
);
REVOKE INSERT, UPDATE, DELETE ON app.platform_plans FROM app_runtime;

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

-- Rooms, halls, grounds, courts. Pool lanes in V2.
CREATE TABLE app.resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id   uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  capacity    integer,
  deleted_at  timestamptz
);
CREATE INDEX resources_tenant_branch_idx ON app.resources (tenant_id, branch_id) WHERE deleted_at IS NULL;
SELECT app.set_tenant_isolation('app.resources');

-- Append-only. tenant_id is NULL for platform-level actions, which only the
-- platform role writes; tenants see and write only their own rows.
CREATE TABLE app.audit_log (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid REFERENCES app.tenants(id) ON DELETE RESTRICT,
  actor_type      text NOT NULL,
  actor_id        uuid,
  impersonated_by uuid,
  action          text NOT NULL,
  entity_type     text,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip              inet,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_at_idx ON app.audit_log (tenant_id, at DESC);
CREATE INDEX audit_log_entity_idx ON app.audit_log (tenant_id, entity_type, entity_id, at DESC);
SELECT app.set_tenant_isolation('app.audit_log');
REVOKE UPDATE, DELETE ON app.audit_log FROM app_runtime, app_platform;

-- Login-page branding by subdomain, before any tenant context exists. Returns
-- one tenant's public fields; app_runtime still cannot read app.tenants directly.
CREATE FUNCTION app.resolve_tenant_slug(p_slug text)
RETURNS TABLE (id uuid, name text, slug text, status text, vertical_preset text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT t.id, t.name, t.slug::text, t.status, t.vertical_preset
    FROM app.tenants t
   WHERE t.slug = p_slug AND t.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION app.resolve_tenant_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_tenant_slug(text) TO app_runtime;

-- down
DROP FUNCTION IF EXISTS app.resolve_tenant_slug(text);
DROP TABLE IF EXISTS app.audit_log;
DROP TABLE IF EXISTS app.resources;
DROP TABLE IF EXISTS app.tenant_subscriptions;
DROP TABLE IF EXISTS app.platform_plans;
