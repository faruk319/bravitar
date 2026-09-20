-- up
-- Schema, extensions, the two application roles, and the RLS helper.
-- Runs as the owner role (postgres). Passwords are never written here: the
-- runner exposes APP_RUNTIME_PASSWORD / APP_PLATFORM_PASSWORD as session settings.

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

-- app_runtime: what the app and worker connect as. Cannot bypass RLS, owns nothing.
-- app_platform: platform-admin only, exempt from RLS, used solely inside withPlatformAdmin().
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOINHERIT;
  END IF;
  IF COALESCE(current_setting('app.runtime_password', true), '') <> '' THEN
    EXECUTE format('ALTER ROLE app_runtime PASSWORD %L', current_setting('app.runtime_password', true));
  END IF;
  IF COALESCE(current_setting('app.platform_password', true), '') <> '' THEN
    EXECUTE format('ALTER ROLE app_platform PASSWORD %L', current_setting('app.platform_password', true));
  END IF;
END $$;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
-- Supabase's API roles must never reach our tables (they don't exist on vanilla Postgres).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', r);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA app, extensions TO app_runtime, app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime, app_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_runtime, app_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime, app_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_runtime, app_platform;

-- One call per tenant-scoped table. Idempotent, so it can be re-run for every table
-- with a tenant_id column after any migration. Fails closed when no tenant is set:
-- current_setting() yields '' after a transaction-local value reverts, hence NULLIF.
CREATE OR REPLACE FUNCTION app.set_tenant_isolation(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s FOR ALL TO app_runtime '
    'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
    'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
    tbl);
END $$;
REVOKE ALL ON FUNCTION app.set_tenant_isolation(regclass) FROM PUBLIC, app_runtime, app_platform;

-- down
-- The roles own nothing, so dropping them only needs their privileges revoked.
-- (DROP OWNED BY needs role membership, which a non-superuser migrator lacks.)
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_runtime, app_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE USAGE, SELECT ON SEQUENCES FROM app_runtime, app_platform;
DROP SCHEMA IF EXISTS app CASCADE;
REVOKE ALL ON SCHEMA extensions FROM app_runtime, app_platform;
DROP ROLE IF EXISTS app_runtime;
DROP ROLE IF EXISTS app_platform;
