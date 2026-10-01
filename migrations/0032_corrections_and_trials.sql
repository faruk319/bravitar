-- up
-- Corrections (agreed 2026-09-30): a bill can be voided and a payment
-- cancelled, each with a reason; both keep their record. A void bill has
-- nothing paid on it and no longer holds its period, so a module whose start
-- was undone can be paid again. started marks the payment that started its
-- module.
-- Trial days (agreed 2026-10-01): a module may have its own trial length;
-- blank uses billing_settings.trial_days.
ALTER TABLE app.billing_invoices DROP CONSTRAINT billing_invoices_status_check;
ALTER TABLE app.billing_invoices
  ADD CONSTRAINT billing_invoices_status_check CHECK (status IN ('open','paid','void')),
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_reason text,
  ADD COLUMN voided_by uuid REFERENCES app.platform_admins(id),
  ADD CONSTRAINT billing_invoices_void_check CHECK (
    CASE WHEN status = 'void' THEN voided_at IS NOT NULL AND coalesce(trim(void_reason), '') <> '' AND paid_paise = 0
         ELSE voided_at IS NULL AND void_reason IS NULL AND voided_by IS NULL END);
ALTER TABLE app.billing_invoices DROP CONSTRAINT billing_invoices_subscription_id_period_start_key;
CREATE UNIQUE INDEX billing_invoices_period_uq ON app.billing_invoices (subscription_id, period_start) WHERE status <> 'void';

ALTER TABLE app.billing_payments
  ADD COLUMN started boolean NOT NULL DEFAULT false,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancel_reason text,
  ADD COLUMN cancelled_by uuid REFERENCES app.platform_admins(id),
  ADD CONSTRAINT billing_payments_cancel_check CHECK (
    CASE WHEN cancelled_at IS NULL THEN cancel_reason IS NULL AND cancelled_by IS NULL
         ELSE coalesce(trim(cancel_reason), '') <> '' END);

ALTER TABLE app.activities ADD COLUMN trial_days smallint CHECK (trial_days BETWEEN 0 AND 365);
GRANT UPDATE (trial_days) ON app.activities TO app_platform;

-- down
-- Refused while a bill is void or a payment cancelled: neither existed before.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.billing_invoices WHERE status = 'void')
     OR EXISTS (SELECT 1 FROM app.billing_payments WHERE cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'void bills or cancelled payments exist; they can''t go back';
  END IF;
END $$;
REVOKE UPDATE (trial_days) ON app.activities FROM app_platform;
ALTER TABLE app.activities DROP COLUMN trial_days;
ALTER TABLE app.billing_payments
  DROP CONSTRAINT billing_payments_cancel_check,
  DROP COLUMN cancelled_by,
  DROP COLUMN cancel_reason,
  DROP COLUMN cancelled_at,
  DROP COLUMN started;
DROP INDEX app.billing_invoices_period_uq;
ALTER TABLE app.billing_invoices ADD CONSTRAINT billing_invoices_subscription_id_period_start_key UNIQUE (subscription_id, period_start);
ALTER TABLE app.billing_invoices
  DROP CONSTRAINT billing_invoices_void_check,
  DROP COLUMN voided_by,
  DROP COLUMN void_reason,
  DROP COLUMN voided_at,
  DROP CONSTRAINT billing_invoices_status_check;
ALTER TABLE app.billing_invoices ADD CONSTRAINT billing_invoices_status_check CHECK (status IN ('open','paid'));
