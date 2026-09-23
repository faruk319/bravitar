-- up
-- One-time links for staff to set a password (agreed 2026-09-23). Only the
-- token's hash is stored; a new link expires the older ones.
CREATE TABLE app.staff_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  staff_id    uuid NOT NULL REFERENCES app.staff_users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  uuid REFERENCES app.staff_users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_invites_staff_idx ON app.staff_invites (tenant_id, staff_id);
SELECT app.set_tenant_isolation('app.staff_invites');

-- The invite page has no tenant context yet: find the invite by token hash.
CREATE FUNCTION app.invite_by_token_hash(p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, staff_id uuid, expires_at timestamptz, used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT i.id, i.tenant_id, i.staff_id, i.expires_at, i.used_at
    FROM app.staff_invites i
   WHERE i.token_hash = p_hash
$$;
REVOKE ALL ON FUNCTION app.invite_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invite_by_token_hash(text) TO app_runtime;

-- down
DROP FUNCTION IF EXISTS app.invite_by_token_hash(text);
DROP TABLE IF EXISTS app.staff_invites;
