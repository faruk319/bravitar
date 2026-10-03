-- up
-- Family access (agreed 2026-10-03): more relations, one manager per student,
-- and removing someone's access to a student without deleting them.

ALTER TABLE app.student_guardians DROP CONSTRAINT student_guardians_relation_check;
ALTER TABLE app.student_guardians ADD CONSTRAINT student_guardians_relation_check
  CHECK (relation IN ('father', 'mother', 'brother', 'sister', 'grandparent', 'spouse', 'guardian', 'cousin', 'friend', 'other', 'self'));
ALTER TABLE app.student_guardians
  ADD COLUMN is_manager boolean NOT NULL DEFAULT false,
  ADD COLUMN removed_at timestamptz;

-- Existing students: the family's main contact manages if linked, else the
-- person added first. An adult's only link is to themselves.
UPDATE app.student_guardians sg SET is_manager = true
  FROM (
    SELECT DISTINCT ON (l.student_id) l.student_id, l.guardian_id
      FROM app.student_guardians l JOIN app.guardians g ON g.id = l.guardian_id
     WHERE g.deleted_at IS NULL
     ORDER BY l.student_id, g.is_primary DESC, g.created_at, g.id
  ) pick
 WHERE sg.student_id = pick.student_id AND sg.guardian_id = pick.guardian_id;

CREATE UNIQUE INDEX student_guardians_one_manager ON app.student_guardians (student_id) WHERE is_manager AND removed_at IS NULL;

-- Portal sign-in only counts children someone still has access to.
CREATE OR REPLACE FUNCTION app.guardian_academies_by_phone(p_phone text)
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
                  WHERE sg.guardian_id = g.id AND sg.removed_at IS NULL AND s.deleted_at IS NULL)
   ORDER BY t.name
$$;

-- down
CREATE OR REPLACE FUNCTION app.guardian_academies_by_phone(p_phone text)
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

DROP INDEX IF EXISTS app.student_guardians_one_manager;
-- Removed access must not come back with the column.
DELETE FROM app.student_guardians WHERE removed_at IS NOT NULL;
ALTER TABLE app.student_guardians DROP COLUMN removed_at, DROP COLUMN is_manager;
UPDATE app.student_guardians SET relation = 'other' WHERE relation NOT IN ('father', 'mother', 'self', 'other');
ALTER TABLE app.student_guardians DROP CONSTRAINT student_guardians_relation_check;
ALTER TABLE app.student_guardians ADD CONSTRAINT student_guardians_relation_check CHECK (relation IN ('father', 'mother', 'self', 'other'));
