-- up
-- Impersonation (Prompt 21, read-write and tagged): Bravitar support signs in
-- as an academy's owner for 2 hours, with a reason. The one-time pass carries
-- who and why; every audit row written meanwhile is tagged through the
-- transaction's app.impersonated_by.

ALTER TABLE app.sessions_auth ADD COLUMN impersonation_reason text;

ALTER TABLE app.login_handoffs
  ADD COLUMN impersonated_by uuid,
  ADD COLUMN impersonation_reason text;

-- A pooled connection keeps a once-set custom setting as '' afterwards.
ALTER TABLE app.audit_log
  ALTER COLUMN impersonated_by SET DEFAULT NULLIF(current_setting('app.impersonated_by', true), '')::uuid;

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

-- down
DROP FUNCTION app.session_by_token_hash(text);
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

ALTER TABLE app.audit_log ALTER COLUMN impersonated_by DROP DEFAULT;
ALTER TABLE app.login_handoffs
  DROP COLUMN impersonation_reason,
  DROP COLUMN impersonated_by;
ALTER TABLE app.sessions_auth DROP COLUMN impersonation_reason;
