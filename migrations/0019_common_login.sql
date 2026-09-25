-- up
-- One login page for staff (agreed 2026-09-25). Before any academy is known,
-- which academies have an active staff account with this email; the password
-- is then checked inside each academy's own context.
CREATE FUNCTION app.staff_academies_by_email(p_email extensions.citext)
RETURNS TABLE (tenant_id uuid, slug text, name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT t.id, t.slug, t.name
    FROM app.staff_users s
    JOIN app.tenants t ON t.id = s.tenant_id
   WHERE s.email = p_email AND s.is_active AND s.deleted_at IS NULL
     AND t.status = 'active' AND t.deleted_at IS NULL
   ORDER BY t.name
$$;
REVOKE ALL ON FUNCTION app.staff_academies_by_email(extensions.citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.staff_academies_by_email(extensions.citext) TO app_runtime;

-- A one-time pass from the main site to the academy's own address, where the
-- session cookie is set. Only the token's hash is stored.
CREATE TABLE app.login_handoffs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  staff_id    uuid NOT NULL REFERENCES app.staff_users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
SELECT app.set_tenant_isolation('app.login_handoffs');
REVOKE DELETE ON app.login_handoffs FROM app_runtime;

-- down
DROP TABLE IF EXISTS app.login_handoffs;
DROP FUNCTION IF EXISTS app.staff_academies_by_email(extensions.citext);
