-- up
-- Member + Guardian + Payer replaces the household (docs/superpowers/specs/
-- 2026-10-07-member-guardian-payer.md). Expand and backfill only; nothing reads
-- these yet and household_id still carries the app. 0040 drops it.

ALTER TABLE app.guardians
  ADD COLUMN address text,
  ADD COLUMN notes text;

ALTER TABLE app.students
  ADD COLUMN address text;

ALTER TABLE app.enrollments
  ADD COLUMN payer_guardian_id uuid REFERENCES app.guardians(id),
  ADD COLUMN payer_member_id uuid REFERENCES app.students(id),
  ADD CONSTRAINT enrollments_one_payer
    CHECK (payer_guardian_id IS NULL OR payer_member_id IS NULL);

ALTER TABLE app.invoices
  ADD COLUMN payer_guardian_id uuid REFERENCES app.guardians(id),
  ADD COLUMN payer_member_id uuid REFERENCES app.students(id),
  ADD COLUMN bill_to_name text,
  ADD CONSTRAINT invoices_one_payer
    CHECK (payer_guardian_id IS NULL OR payer_member_id IS NULL);

ALTER TABLE app.payments
  ADD COLUMN payer_guardian_id uuid REFERENCES app.guardians(id),
  ADD COLUMN payer_member_id uuid REFERENCES app.students(id),
  ADD CONSTRAINT payments_one_payer
    CHECK (payer_guardian_id IS NULL OR payer_member_id IS NULL);

ALTER TABLE app.tenants
  ADD COLUMN guardian_mode text NOT NULL DEFAULT 'optional'
    CONSTRAINT tenants_guardian_mode_check
    CHECK (guardian_mode IN ('off', 'optional', 'required_under_age')),
  ADD COLUMN guardian_required_under_age integer NOT NULL DEFAULT 18
    CONSTRAINT tenants_guardian_age_check
    CHECK (guardian_required_under_age BETWEEN 13 AND 25),
  ADD COLUMN member_login_min_age integer NOT NULL DEFAULT 18
    CONSTRAINT tenants_member_login_age_check
    CHECK (member_login_min_age >= 13);

-- The payer is the new lookup key; the household indexes go with household_id.
CREATE INDEX invoices_payer_idx ON app.invoices (tenant_id, payer_guardian_id);
CREATE INDEX payments_payer_idx ON app.payments (tenant_id, payer_guardian_id);

-- Backfill: a household's payer is its primary guardian, else its earliest
-- guardian; live guardians come first, a soft-deleted one is the fallback.
-- Enrollments take the student's own manager (0037) where there is one.
-- Address and notes move from the household to the payer guardian.
WITH primary_guardian AS (
  SELECT DISTINCT ON (household_id) household_id, id, full_name
  FROM app.guardians
  ORDER BY household_id, (deleted_at IS NOT NULL), is_primary DESC, created_at, id
)
UPDATE app.guardians g
SET address = h.address, notes = h.notes
FROM app.households h, primary_guardian p
WHERE g.household_id = h.id AND p.household_id = h.id AND p.id = g.id AND h.deleted_at IS NULL;

WITH primary_guardian AS (
  SELECT DISTINCT ON (household_id) household_id, id, full_name
  FROM app.guardians
  ORDER BY household_id, (deleted_at IS NOT NULL), is_primary DESC, created_at, id
)
UPDATE app.invoices i
SET payer_guardian_id = p.id,
    bill_to_name = COALESCE(p.full_name, h.name)
FROM app.households h, primary_guardian p
WHERE i.household_id = h.id AND p.household_id = h.id;

WITH primary_guardian AS (
  SELECT DISTINCT ON (household_id) household_id, id
  FROM app.guardians
  ORDER BY household_id, (deleted_at IS NOT NULL), is_primary DESC, created_at, id
)
UPDATE app.payments pay
SET payer_guardian_id = p.id
FROM primary_guardian p
WHERE pay.household_id = p.household_id;

WITH primary_guardian AS (
  SELECT DISTINCT ON (household_id) household_id, id
  FROM app.guardians
  ORDER BY household_id, (deleted_at IS NOT NULL), is_primary DESC, created_at, id
)
UPDATE app.enrollments e
SET payer_guardian_id = COALESCE(m.guardian_id, p.id)
FROM app.students s
JOIN primary_guardian p ON p.household_id = s.household_id
LEFT JOIN app.student_guardians m ON m.student_id = s.id AND m.is_manager AND m.removed_at IS NULL
WHERE e.student_id = s.id;

-- A household with no guardian at all would leave money rows unpaid-for.
-- Fail loudly rather than ship nulls into invoices, payments and enrollments.
DO $$
DECLARE orphans integer;
BEGIN
  SELECT count(*) INTO orphans FROM app.invoices WHERE payer_guardian_id IS NULL AND payer_member_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'backfill left % invoice(s) with no payer', orphans;
  END IF;
  SELECT count(*) INTO orphans FROM app.payments WHERE payer_guardian_id IS NULL AND payer_member_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'backfill left % payment(s) with no payer', orphans;
  END IF;
  SELECT count(*) INTO orphans FROM app.enrollments WHERE payer_guardian_id IS NULL AND payer_member_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'backfill left % enrollment(s) with no payer', orphans;
  END IF;
END $$;

-- down
DROP INDEX app.payments_payer_idx;
DROP INDEX app.invoices_payer_idx;
ALTER TABLE app.payments DROP CONSTRAINT payments_one_payer, DROP COLUMN payer_guardian_id, DROP COLUMN payer_member_id;
ALTER TABLE app.invoices DROP CONSTRAINT invoices_one_payer, DROP COLUMN payer_guardian_id, DROP COLUMN payer_member_id, DROP COLUMN bill_to_name;
ALTER TABLE app.enrollments DROP CONSTRAINT enrollments_one_payer, DROP COLUMN payer_guardian_id, DROP COLUMN payer_member_id;
ALTER TABLE app.students DROP COLUMN address;
ALTER TABLE app.guardians DROP COLUMN address, DROP COLUMN notes;
ALTER TABLE app.tenants
  DROP CONSTRAINT tenants_guardian_mode_check, DROP CONSTRAINT tenants_guardian_age_check, DROP CONSTRAINT tenants_member_login_age_check,
  DROP COLUMN guardian_mode, DROP COLUMN guardian_required_under_age, DROP COLUMN member_login_min_age;
