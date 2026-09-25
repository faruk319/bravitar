-- up
-- docs/02 §4 otp_codes: 6-digit codes sent on WhatsApp from Bravitar's own
-- number (agreed 2026-09-25), for a staff password reset now and parent login
-- later. A phone is not an academy's, so there is no tenant_id; the app never
-- reads the table, only the two functions below, which keep the docs/01
-- limits: 5 minutes to use, single use, 3 per phone per 15 minutes, and
-- 5 wrong tries lock the phone for an hour.
CREATE TABLE app.otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('password_reset', 'portal_login')),
  attempts    smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON app.otp_codes (phone, purpose, created_at DESC);
ALTER TABLE app.otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.otp_codes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.otp_codes FROM app_runtime, app_platform;

-- Wrong tries on this phone's codes from the last hour.
CREATE FUNCTION app.otp_locked(p_phone text, p_purpose text, p_now timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT coalesce(sum(attempts), 0) >= 5
    FROM app.otp_codes
   WHERE phone = p_phone AND purpose = p_purpose AND created_at > p_now - interval '1 hour'
$$;
REVOKE ALL ON FUNCTION app.otp_locked(text, text, timestamptz) FROM PUBLIC;

-- Keeps a new code unless the phone is locked or already had 3 in 15 minutes.
CREATE FUNCTION app.otp_issue(p_phone text, p_purpose text, p_code_hash text, p_now timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, extensions
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('otp:' || p_phone));
  IF app.otp_locked(p_phone, p_purpose, p_now)
     OR (SELECT count(*) FROM app.otp_codes WHERE phone = p_phone AND purpose = p_purpose AND created_at > p_now - interval '15 minutes') >= 3 THEN
    RETURN false;
  END IF;
  INSERT INTO app.otp_codes (phone, code_hash, purpose, expires_at, created_at)
  VALUES (p_phone, p_code_hash, p_purpose, p_now + interval '5 minutes', p_now);
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION app.otp_issue(text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_issue(text, text, text, timestamptz) TO app_runtime;

-- 'ok' uses the newest live code up; 'wrong' counts a try; 'locked' after
-- 5 wrong in an hour; 'none' when no code is live.
CREATE FUNCTION app.otp_check(p_phone text, p_purpose text, p_code_hash text, p_now timestamptz)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, extensions
AS $$
DECLARE
  live app.otp_codes;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('otp:' || p_phone));
  IF app.otp_locked(p_phone, p_purpose, p_now) THEN
    RETURN 'locked';
  END IF;
  SELECT * INTO live FROM app.otp_codes
   WHERE phone = p_phone AND purpose = p_purpose AND consumed_at IS NULL AND expires_at > p_now
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  IF live.code_hash = p_code_hash THEN
    UPDATE app.otp_codes SET consumed_at = p_now WHERE id = live.id;
    RETURN 'ok';
  END IF;
  UPDATE app.otp_codes SET attempts = attempts + 1 WHERE id = live.id;
  RETURN 'wrong';
END
$$;
REVOKE ALL ON FUNCTION app.otp_check(text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.otp_check(text, text, text, timestamptz) TO app_runtime;

-- down
DROP FUNCTION IF EXISTS app.otp_check(text, text, text, timestamptz);
DROP FUNCTION IF EXISTS app.otp_issue(text, text, text, timestamptz);
DROP FUNCTION IF EXISTS app.otp_locked(text, text, timestamptz);
DROP TABLE IF EXISTS app.otp_codes;
