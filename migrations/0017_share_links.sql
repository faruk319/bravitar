-- up
-- Private no-login links to one receipt or invoice, carried in messages
-- (docs/03 §10, agreed 2026-09-25). Only the token's hash is stored.
ALTER TABLE app.tenants ADD COLUMN message_language text NOT NULL DEFAULT 'en' CHECK (message_language IN ('en','hi','mr'));

CREATE TABLE app.share_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  kind       text NOT NULL CHECK (kind IN ('invoice','receipt')),
  entity_id  uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES app.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX share_links_entity_idx ON app.share_links (tenant_id, kind, entity_id);
SELECT app.set_tenant_isolation('app.share_links');

-- The public page knows only the token; this says whose it is.
CREATE FUNCTION app.share_link_by_token_hash(p_hash text)
RETURNS TABLE (tenant_id uuid, kind text, entity_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT l.tenant_id, l.kind, l.entity_id
    FROM app.share_links l
    JOIN app.tenants t ON t.id = l.tenant_id
   WHERE l.token_hash = p_hash AND l.revoked_at IS NULL AND t.status = 'active' AND t.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION app.share_link_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.share_link_by_token_hash(text) TO app_runtime;

-- down
DROP FUNCTION IF EXISTS app.share_link_by_token_hash(text);
DROP TABLE IF EXISTS app.share_links;
ALTER TABLE app.tenants DROP COLUMN IF EXISTS message_language;
