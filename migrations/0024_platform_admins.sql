-- up
-- docs/02 §2 platform_admins, for the /platform area (Prompt 21): email,
-- password and an authenticator app (agreed 2026-09-26). The authenticator
-- secret is sealed by src/lib/crypto (bytea, not the docs' text), and the last
-- time step used is kept so a code works once. Only the platform role reads it.
CREATE TABLE app.platform_admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           extensions.citext UNIQUE NOT NULL,
  password_hash   text NOT NULL,
  totp_secret     bytea NOT NULL,
  totp_last_step  bigint NOT NULL DEFAULT 0,
  full_name       text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app.platform_admins FROM app_runtime;

-- Sign-in tries, for 5 wrong in 15 minutes per email.
CREATE TABLE app.platform_login_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        extensions.citext NOT NULL,
  ip           inet,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_login_attempts_email_idx ON app.platform_login_attempts (email, attempted_at DESC);
REVOKE ALL ON app.platform_login_attempts FROM app_runtime;

-- down
DROP TABLE IF EXISTS app.platform_login_attempts;
DROP TABLE IF EXISTS app.platform_admins;
