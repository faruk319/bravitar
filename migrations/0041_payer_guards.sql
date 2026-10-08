-- up
-- Closes the gaps 0040 left (docs/superpowers/specs/2026-10-07-member-guardian-payer.md):
-- a receipt name that means something, a payer that cannot move under money, and
-- the rule that a member only ever pays for themselves.

-- 1. bill_to_name must be a name, not just present.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.payments WHERE trim(bill_to_name) = '';
  IF n > 0 THEN RAISE EXCEPTION '% payment(s) have a blank bill_to_name', n; END IF;
END $$;
ALTER TABLE app.payments ADD CONSTRAINT payments_bill_to_name_present CHECK (trim(bill_to_name) <> '');

-- 2. The allocation guard also runs when an allocation is re-pointed.
DROP TRIGGER payment_allocations_same_payer ON app.payment_allocations;
CREATE TRIGGER payment_allocations_same_payer BEFORE INSERT OR UPDATE OF payment_id, invoice_id ON app.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION app.payment_allocation_same_payer();

-- 3. An invoice's payer cannot change once money is allocated, or the guard above is
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

-- 4. A payer is the member themselves or a guardian (decided 2026-10-08): one member
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
ALTER TABLE app.enrollments DROP CONSTRAINT enrollments_member_pays_own;
ALTER TABLE app.invoices DROP CONSTRAINT invoices_member_pays_own;
DROP TRIGGER invoices_payer_frozen ON app.invoices;
DROP FUNCTION app.invoice_payer_frozen_once_allocated();
DROP TRIGGER payment_allocations_same_payer ON app.payment_allocations;
CREATE TRIGGER payment_allocations_same_payer BEFORE INSERT ON app.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION app.payment_allocation_same_payer();
ALTER TABLE app.payments DROP CONSTRAINT payments_bill_to_name_present;
