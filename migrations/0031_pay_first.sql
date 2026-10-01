-- up
-- Pay first, then start (agreed 2026-09-30): a trial that ends unpaid, and any
-- new paid start, waits read-only as 'pending' until its first period is paid.
-- Payments are recorded by hand on /platform, one branch module at a time;
-- only the platform role writes them, academies read their own.
ALTER TABLE app.activity_subscriptions DROP CONSTRAINT activity_subscriptions_status_check;
ALTER TABLE app.activity_subscriptions ADD CONSTRAINT activity_subscriptions_status_check CHECK (status IN ('trial','pending','active','paused','cancelled'));

ALTER TABLE app.billing_invoices ADD COLUMN paid_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE app.billing_invoices
  ADD CONSTRAINT billing_invoices_paid_within_total CHECK (paid_paise >= 0 AND paid_paise <= total_paise),
  ADD CONSTRAINT billing_invoices_status_matches_paid CHECK ((status = 'paid') = (paid_paise = total_paise));

-- The form's request id makes a double click one payment.
CREATE TABLE app.billing_payments (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES app.activity_subscriptions(id),
  request_id      uuid NOT NULL UNIQUE,
  amount_paise    bigint NOT NULL CHECK (amount_paise > 0),
  method          text NOT NULL CHECK (method IN ('upi','bank_transfer','cash','cheque')),
  reference       text,
  received_on     date NOT NULL,
  note            text,
  recorded_by     uuid REFERENCES app.platform_admins(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_payments_tenant_idx ON app.billing_payments (tenant_id, created_at DESC);
CREATE INDEX billing_payments_subscription_idx ON app.billing_payments (subscription_id);
SELECT app.set_tenant_isolation('app.billing_payments');
REVOKE INSERT, UPDATE, DELETE ON app.billing_payments FROM app_runtime;

-- Which bills a payment paid, and how much of each.
CREATE TABLE app.billing_allocations (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  payment_id   uuid NOT NULL REFERENCES app.billing_payments(id),
  invoice_id   uuid NOT NULL REFERENCES app.billing_invoices(id),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, invoice_id)
);
CREATE INDEX billing_allocations_invoice_idx ON app.billing_allocations (invoice_id);
SELECT app.set_tenant_isolation('app.billing_allocations');
REVOKE INSERT, UPDATE, DELETE ON app.billing_allocations FROM app_runtime;

-- down
-- Refused while a module waits for payment: there was no such state before.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.activity_subscriptions WHERE status = 'pending') THEN
    RAISE EXCEPTION 'modules are waiting for payment; start or cancel them first';
  END IF;
END $$;
DROP TABLE app.billing_allocations;
DROP TABLE app.billing_payments;
ALTER TABLE app.billing_invoices
  DROP CONSTRAINT billing_invoices_status_matches_paid,
  DROP CONSTRAINT billing_invoices_paid_within_total,
  DROP COLUMN paid_paise;
ALTER TABLE app.activity_subscriptions DROP CONSTRAINT activity_subscriptions_status_check;
ALTER TABLE app.activity_subscriptions ADD CONSTRAINT activity_subscriptions_status_check CHECK (status IN ('trial','active','paused','cancelled'));
