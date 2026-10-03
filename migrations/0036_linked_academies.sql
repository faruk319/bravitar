-- up
-- The staff academy switcher (agreed 2026-10-02): the academies a session may
-- switch to without signing in again, each proven at sign-in (the same
-- password worked there, or a reset code covered it). A pass carries them to
-- the session it opens, and how it was made (via) for that sign-in's audit row.

ALTER TABLE app.sessions_auth ADD COLUMN linked_tenants uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE app.login_handoffs
  ADD COLUMN linked_tenants uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN via text;

DROP FUNCTION app.session_by_token_hash(text);
CREATE FUNCTION app.session_by_token_hash(p_hash text)
RETURNS TABLE (
  id uuid, actor_type text, actor_id uuid, tenant_id uuid, impersonated_by uuid,
  impersonation_reason text, linked_tenants uuid[], cached_context jsonb, expires_at timestamptz, revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT s.id, s.actor_type, s.actor_id, s.tenant_id, s.impersonated_by,
         s.impersonation_reason, s.linked_tenants, s.cached_context, s.expires_at, s.revoked_at
    FROM app.sessions_auth s
   WHERE s.token_hash = p_hash
$$;
REVOKE ALL ON FUNCTION app.session_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.session_by_token_hash(text) TO app_runtime;

-- down
DROP FUNCTION app.session_by_token_hash(text);
CREATE FUNCTION app.session_by_token_hash(p_hash text)
RETURNS TABLE (
  id uuid, actor_type text, actor_id uuid, tenant_id uuid, impersonated_by uuid,
  impersonation_reason text, cached_context jsonb, expires_at timestamptz, revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT s.id, s.actor_type, s.actor_id, s.tenant_id, s.impersonated_by,
         s.impersonation_reason, s.cached_context, s.expires_at, s.revoked_at
    FROM app.sessions_auth s
   WHERE s.token_hash = p_hash
$$;
REVOKE ALL ON FUNCTION app.session_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.session_by_token_hash(text) TO app_runtime;

ALTER TABLE app.login_handoffs DROP COLUMN via, DROP COLUMN linked_tenants;
ALTER TABLE app.sessions_auth DROP COLUMN linked_tenants;
