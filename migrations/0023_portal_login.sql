-- up
-- Parents and adult students sign in by phone (Prompt 20). Before any academy
-- is known: the academies where this phone is a guardian who may sign in and
-- has a child there.
CREATE FUNCTION app.guardian_academies_by_phone(p_phone text)
RETURNS TABLE (tenant_id uuid, slug text, name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, extensions
AS $$
  SELECT t.id, t.slug, t.name
    FROM app.guardians g
    JOIN app.tenants t ON t.id = g.tenant_id
   WHERE g.phone = p_phone AND g.can_login AND g.deleted_at IS NULL
     AND t.status = 'active' AND t.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM app.student_guardians sg JOIN app.students s ON s.id = sg.student_id
                  WHERE sg.guardian_id = g.id AND s.deleted_at IS NULL)
   ORDER BY t.name
$$;
REVOKE ALL ON FUNCTION app.guardian_academies_by_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_academies_by_phone(text) TO app_runtime;

CREATE INDEX guardians_phone_idx ON app.guardians (phone);

-- A pass to the academy's address carries a guardian or a staff member.
ALTER TABLE app.login_handoffs
  ALTER COLUMN staff_id DROP NOT NULL,
  ADD COLUMN guardian_id uuid REFERENCES app.guardians(id) ON DELETE CASCADE,
  ADD CONSTRAINT login_handoffs_one_person CHECK (num_nonnulls(staff_id, guardian_id) = 1);

-- down
DELETE FROM app.login_handoffs WHERE guardian_id IS NOT NULL;
ALTER TABLE app.login_handoffs
  DROP CONSTRAINT IF EXISTS login_handoffs_one_person,
  DROP COLUMN IF EXISTS guardian_id,
  ALTER COLUMN staff_id SET NOT NULL;
DROP INDEX IF EXISTS app.guardians_phone_idx;
DROP FUNCTION IF EXISTS app.guardian_academies_by_phone(text);
