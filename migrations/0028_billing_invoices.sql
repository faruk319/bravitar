-- up
-- Bravitar's bills (agreed 2026-09-30): one per activity in a branch per
-- month, in advance, numbered BRV/<FY>/00001 across all academies. A ₹0 month
-- has no bill. Only the platform role writes them; academies read their own.
CREATE TABLE app.billing_invoice_series (
  fy         text PRIMARY KEY,
  next_value integer NOT NULL DEFAULT 1 CHECK (next_value >= 1)
);
REVOKE ALL ON app.billing_invoice_series FROM app_runtime;

-- The description is copied at issue, so a later rename leaves old bills
-- alone; so is Bravitar's GSTIN. period_end is the next bill date.
CREATE TABLE app.billing_invoices (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES app.activity_subscriptions(id),
  number          text NOT NULL UNIQUE,
  description     text NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  subtotal_paise  bigint NOT NULL CHECK (subtotal_paise > 0),
  tax_rate_bp     integer NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_paise       bigint NOT NULL CHECK (tax_paise >= 0),
  total_paise     bigint NOT NULL,
  gstin           text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
  issued_on       date NOT NULL,
  due_on          date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_start),
  CHECK (period_end > period_start),
  CHECK (due_on >= issued_on),
  CHECK (total_paise = subtotal_paise + tax_paise)
);
CREATE INDEX billing_invoices_tenant_idx ON app.billing_invoices (tenant_id, issued_on DESC);
CREATE INDEX billing_invoices_open_idx ON app.billing_invoices (due_on) WHERE status = 'open';
SELECT app.set_tenant_isolation('app.billing_invoices');
REVOKE INSERT, UPDATE, DELETE ON app.billing_invoices FROM app_runtime;

-- down
DROP TABLE app.billing_invoices;
DROP TABLE app.billing_invoice_series;
