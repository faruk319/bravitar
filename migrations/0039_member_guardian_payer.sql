-- up
-- Member + Guardian + Payer replaces the household (docs/superpowers/specs/
-- 2026-10-07-member-guardian-payer.md). One file, in dependency order: add payer
-- columns, backfill them FROM households, drop households, then add the guards.

-- Part 1: expand and backfill. Reads households, so it must run before part 2.

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

-- Part 2: contract. Nothing reads a household any more; this drops it and closes
-- three gaps the old model hid.

-- 1. A receipt carries its own bill-to name. It was read from the audit log (and
-- falling back to invoices, then the live payer), so a retention job could have
-- changed an issued document. Copy it onto the payment once, then require it.
ALTER TABLE app.payments ADD COLUMN bill_to_name text;

UPDATE app.payments p
SET bill_to_name = (SELECT a.after ->> 'billToName' FROM app.audit_log a
                    WHERE a.entity_type = 'payment' AND a.entity_id = p.id AND a.action = 'payment.create'
                    ORDER BY a.id LIMIT 1);

UPDATE app.payments p
SET bill_to_name = (SELECT i.bill_to_name FROM app.payment_allocations pa JOIN app.invoices i ON i.id = pa.invoice_id
                    WHERE pa.payment_id = p.id AND pa.kind = 'receipt' AND i.bill_to_name IS NOT NULL
                    ORDER BY pa.created_at, pa.id LIMIT 1)
WHERE p.bill_to_name IS NULL;

-- Last resort: the payer's name today, copied once.
UPDATE app.payments p
SET bill_to_name = CASE WHEN p.payer_guardian_id IS NOT NULL
                        THEN (SELECT g.full_name FROM app.guardians g WHERE g.id = p.payer_guardian_id)
                        ELSE (SELECT s.full_name FROM app.students s WHERE s.id = p.payer_member_id) END
WHERE p.bill_to_name IS NULL;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.payments WHERE bill_to_name IS NULL OR trim(bill_to_name) = '';
  IF n > 0 THEN
    RAISE EXCEPTION 'backfill left % payment(s) with no bill_to_name', n;
  END IF;
END $$;

ALTER TABLE app.payments ALTER COLUMN bill_to_name SET NOT NULL;
ALTER TABLE app.payments ADD CONSTRAINT payments_bill_to_name_present CHECK (trim(bill_to_name) <> '');

-- 2. An allocation never crosses payers, on insert or re-point. A trigger, not a composite foreign key:
-- the payer is two nullable columns, and a foreign key skips any row with a null.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.payment_allocations a
    JOIN app.payments p ON p.id = a.payment_id JOIN app.invoices i ON i.id = a.invoice_id
   WHERE p.payer_guardian_id IS DISTINCT FROM i.payer_guardian_id OR p.payer_member_id IS DISTINCT FROM i.payer_member_id;
  IF n > 0 THEN
    RAISE EXCEPTION '% existing allocation(s) cross payers', n;
  END IF;
END $$;

CREATE FUNCTION app.payment_allocation_same_payer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.payments p JOIN app.invoices i ON i.id = NEW.invoice_id
     WHERE p.id = NEW.payment_id
       AND p.payer_guardian_id IS NOT DISTINCT FROM i.payer_guardian_id
       AND p.payer_member_id IS NOT DISTINCT FROM i.payer_member_id
  ) THEN
    RAISE EXCEPTION 'allocation crosses payers: payment % and invoice % have different payers', NEW.payment_id, NEW.invoice_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payment_allocations_same_payer BEFORE INSERT OR UPDATE OF payment_id, invoice_id ON app.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION app.payment_allocation_same_payer();

-- 3. No invisible invoices: every invoice belongs to a member.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.invoices WHERE student_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% invoice(s) have no student', n;
  END IF;
END $$;
ALTER TABLE app.invoices ALTER COLUMN student_id SET NOT NULL;

-- 4. The households model. The indexes and foreign keys go with the columns;
-- no unique constraint ever included household_id.
ALTER TABLE app.guardians DROP COLUMN household_id;
ALTER TABLE app.students DROP COLUMN household_id;
ALTER TABLE app.invoices DROP COLUMN household_id;
ALTER TABLE app.payments DROP COLUMN household_id;
DROP TABLE app.households;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'app'::regnamespace AND a.attname = 'household_id' AND NOT a.attisdropped;
  IF n > 0 OR to_regclass('app.households') IS NOT NULL THEN
    RAISE EXCEPTION 'households were not fully dropped';
  END IF;
  SELECT count(*) INTO n FROM app.payment_allocations a
    JOIN app.payments p ON p.id = a.payment_id JOIN app.invoices i ON i.id = a.invoice_id
   WHERE p.payer_guardian_id IS DISTINCT FROM i.payer_guardian_id OR p.payer_member_id IS DISTINCT FROM i.payer_member_id;
  IF n > 0 THEN
    RAISE EXCEPTION '% allocation(s) cross payers', n;
  END IF;
END $$;

-- Part 3: guards. A payer cannot move under money; a member pays only for themselves.

-- 5. An invoice's payer cannot change once money is allocated, or the guard above is
-- bypassed. (A payment's payer is already immutable by column privilege.) No existing
-- row can violate this: nothing changes at migration time.
CREATE FUNCTION app.invoice_payer_frozen_once_allocated() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.payer_guardian_id IS DISTINCT FROM OLD.payer_guardian_id OR NEW.payer_member_id IS DISTINCT FROM OLD.payer_member_id)
     AND EXISTS (SELECT 1 FROM app.payment_allocations a WHERE a.invoice_id = OLD.id) THEN
    RAISE EXCEPTION 'the payer of invoice % cannot change once money is allocated', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER invoices_payer_frozen BEFORE UPDATE OF payer_guardian_id, payer_member_id ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoice_payer_frozen_once_allocated();

-- 6. A payer is the member themselves or a guardian (decided 2026-10-08): one member
-- never pays another's invoice; staff add them as a guardian instead.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.invoices WHERE payer_member_id IS NOT NULL AND payer_member_id <> student_id;
  IF n > 0 THEN RAISE EXCEPTION '% invoice(s) are paid by another member', n; END IF;
  SELECT count(*) INTO n FROM app.enrollments WHERE payer_member_id IS NOT NULL AND payer_member_id <> student_id;
  IF n > 0 THEN RAISE EXCEPTION '% enrollment(s) are paid by another member', n; END IF;
END $$;
ALTER TABLE app.invoices ADD CONSTRAINT invoices_member_pays_own CHECK (payer_member_id IS NULL OR payer_member_id = student_id);
ALTER TABLE app.enrollments ADD CONSTRAINT enrollments_member_pays_own CHECK (payer_member_id IS NULL OR payer_member_id = student_id);

-- down
-- Rebuilds structure, NOT data: dropped households, and which household each row
-- belonged to, cannot come back. Every tenant gets one placeholder household and
-- every row points at it, so NOT NULL holds again.
ALTER TABLE app.enrollments DROP CONSTRAINT enrollments_member_pays_own;
ALTER TABLE app.invoices DROP CONSTRAINT invoices_member_pays_own;
DROP TRIGGER invoices_payer_frozen ON app.invoices;
DROP FUNCTION app.invoice_payer_frozen_once_allocated();
CREATE TABLE app.households (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  address     text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
SELECT app.set_tenant_isolation('app.households');

INSERT INTO app.households (tenant_id, name) SELECT id, '-' FROM app.tenants;

ALTER TABLE app.guardians ADD COLUMN household_id uuid REFERENCES app.households(id) ON DELETE RESTRICT;
ALTER TABLE app.students ADD COLUMN household_id uuid REFERENCES app.households(id) ON DELETE RESTRICT;
ALTER TABLE app.invoices ADD COLUMN household_id uuid REFERENCES app.households(id) ON DELETE RESTRICT;
ALTER TABLE app.payments ADD COLUMN household_id uuid REFERENCES app.households(id) ON DELETE RESTRICT;

UPDATE app.guardians x SET household_id = h.id FROM app.households h WHERE h.tenant_id = x.tenant_id;
UPDATE app.students x SET household_id = h.id FROM app.households h WHERE h.tenant_id = x.tenant_id;
UPDATE app.invoices x SET household_id = h.id FROM app.households h WHERE h.tenant_id = x.tenant_id;
UPDATE app.payments x SET household_id = h.id FROM app.households h WHERE h.tenant_id = x.tenant_id;

ALTER TABLE app.guardians ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE app.students ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE app.invoices ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE app.payments ALTER COLUMN household_id SET NOT NULL;

CREATE INDEX guardians_household_idx ON app.guardians (tenant_id, household_id);
CREATE INDEX students_household_idx ON app.students (tenant_id, household_id);
CREATE INDEX invoices_household_idx ON app.invoices (tenant_id, household_id, status);
CREATE INDEX payments_household_idx ON app.payments (tenant_id, household_id);

ALTER TABLE app.invoices ALTER COLUMN student_id DROP NOT NULL;

DROP TRIGGER payment_allocations_same_payer ON app.payment_allocations;
DROP FUNCTION app.payment_allocation_same_payer();

ALTER TABLE app.payments DROP COLUMN bill_to_name;
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
