-- up
-- docs/02-data-model.md §4 sessions_auth, plus the failed-login ledger.

-- Named to avoid clashing with class sessions. tenant_id is NULL only for
-- platform admins (written by the platform role). The one lookup that happens
-- before a tenant is known goes through session_by_token_hash() below.
CREATE TABLE app.sessions_auth (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text UNIQUE NOT NULL,
  actor_type      text NOT NULL CHECK (actor_type IN ('platform','staff','guardian')),
  actor_id        uuid NOT NULL,
  tenant_id       uuid REFERENCES app.tenants(id) ON DELETE RESTRICT,
  impersonated_by uuid,
  cached_context  jsonb,
  ip              inet,
  user_agent      text,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_auth_actor_idx ON app.sessions_auth (actor_type, actor_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_auth_expires_idx ON app.sessions_auth (expires_at);
SELECT app.set_tenant_isolation('app.sessions_auth');
-- Sessions are revoked, never deleted by the app; a platform job prunes them.
REVOKE DELETE ON app.sessions_auth FROM app_runtime;

-- Append-only ledger for the 5-per-15-minutes rule.
CREATE TABLE app.login_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  email        extensions.citext NOT NULL,
  ip           inet,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_lookup_idx ON app.login_attempts (tenant_id, email, attempted_at DESC);
SELECT app.set_tenant_isolation('app.login_attempts');
REVOKE UPDATE, DELETE ON app.login_attempts FROM app_runtime;

-- Cookie token -> session, before any tenant context exists. Only a hash is
-- ever looked up; app_runtime still cannot read sessions_auth without context.
CREATE FUNCTION app.session_by_token_hash(p_hash text)
RETURNS TABLE (
  id uuid, actor_type text, actor_id uuid, tenant_id uuid, impersonated_by uuid,
  cached_context jsonb, expires_at timestamptz, revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT s.id, s.actor_type, s.actor_id, s.tenant_id, s.impersonated_by,
         s.cached_context, s.expires_at, s.revoked_at
    FROM app.sessions_auth s
   WHERE s.token_hash = p_hash
$$;
REVOKE ALL ON FUNCTION app.session_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.session_by_token_hash(text) TO app_runtime;

-- down
DROP FUNCTION IF EXISTS app.session_by_token_hash(text);
DROP TABLE IF EXISTS app.login_attempts;
DROP TABLE IF EXISTS app.sessions_auth;
