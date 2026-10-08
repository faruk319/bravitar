-- up
-- Contract step of docs/superpowers/specs/2026-10-07-member-guardian-payer.md.
-- Nothing reads a household any more (Task 9a); this drops it, and closes three
-- gaps the old model hid. IRREVERSIBLE for data: see -- down.

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

-- 2. An allocation never crosses payers. A trigger, not a composite foreign key:
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

CREATE TRIGGER payment_allocations_same_payer BEFORE INSERT ON app.payment_allocations
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

-- down
-- Rebuilds the structure, not the data: dropped households, and the household
-- each row belonged to, cannot come back. Every tenant gets one placeholder
-- household and every row points at it, so NOT NULL holds again.
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
