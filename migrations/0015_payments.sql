-- up
-- docs/02 §9 payments, allocations and refunds, built to the rules agreed for
-- Prompt 15 (docs/03 §9, agreed 2026-09-24). Money moves only by adding rows:
-- neither app role can change a payment's amount, method, date or receipt
-- number, and allocations and refunds are append-only.

CREATE TABLE app.payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id          uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  household_id       uuid NOT NULL REFERENCES app.households(id) ON DELETE RESTRICT,
  request_id         uuid,                  -- sent by the collect form: the same request twice is one payment
  receipt_number     text NOT NULL,         -- 'RCT/2026-27/0007'
  fy                 text NOT NULL,
  method             text NOT NULL CHECK (method IN ('cash','upi','bank_transfer','cheque','card','online')),
  amount_paise       bigint NOT NULL CHECK (amount_paise > 0),
  received_on        date NOT NULL,         -- printed on the receipt; staff may pick up to 7 days back
  recorded_on        date NOT NULL,         -- the academy's local day it was entered: the collection sheet's day
  received_by        uuid REFERENCES app.staff_users(id),   -- the collector; NULL for gateway payments
  reference          text,                  -- UPI ref, cheque no, bank UTR
  gateway_payment_id text,                  -- Razorpay payment id (Prompt 16)
  notes              text,
  status             text NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('pending','confirmed','failed','refunded','cancelled')),
  cancelled_at       timestamptz,
  cancelled_by       uuid REFERENCES app.staff_users(id),
  cancel_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number),
  CHECK (received_on <= recorded_on),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  -- A CASE, not OR: a NULL reason must fail the check, not slip through as unknown.
  CHECK (CASE WHEN cancelled_at IS NULL THEN cancelled_by IS NULL AND cancel_reason IS NULL
              ELSE cancelled_by IS NOT NULL AND coalesce(trim(cancel_reason), '') <> '' END)
);
CREATE UNIQUE INDEX payments_request_idx ON app.payments (tenant_id, request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX payments_gateway_idx ON app.payments (tenant_id, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE INDEX payments_day_idx ON app.payments (tenant_id, branch_id, recorded_on);
CREATE INDEX payments_household_idx ON app.payments (tenant_id, household_id);
SELECT app.set_tenant_isolation('app.payments');
-- Status and the cancel columns are the only things that ever change.
REVOKE UPDATE, DELETE ON app.payments FROM app_runtime, app_platform;
GRANT UPDATE (status, cancelled_at, cancelled_by, cancel_reason) ON app.payments TO app_runtime, app_platform;

CREATE TABLE app.refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  payment_id   uuid NOT NULL REFERENCES app.payments(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  method       text NOT NULL CHECK (method IN ('cash','upi','bank_transfer','cheque','card','online')),   -- how the money went back
  reference    text,
  reason       text NOT NULL CHECK (length(trim(reason)) > 0),
  refunded_on  date NOT NULL,              -- the academy's local day: the collection sheet's day
  approved_by  uuid REFERENCES app.staff_users(id),      -- holds fees:refund
  refunded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_payment_idx ON app.refunds (tenant_id, payment_id);
CREATE INDEX refunds_day_idx ON app.refunds (tenant_id, refunded_on);
SELECT app.set_tenant_isolation('app.refunds');
REVOKE UPDATE, DELETE ON app.refunds FROM app_runtime, app_platform;

-- A ledger, not one row per (payment, invoice). receipt: applied when the
-- payment was recorded, so it prints on the receipt; advance: the payment's
-- unused money applied later. refund / void / cancel take money back off the
-- invoice with a negative amount. An invoice's paid_paise is the sum of its rows.
CREATE TABLE app.payment_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  payment_id   uuid NOT NULL REFERENCES app.payments(id) ON DELETE RESTRICT,
  invoice_id   uuid NOT NULL REFERENCES app.invoices(id) ON DELETE RESTRICT,
  kind         text NOT NULL CHECK (kind IN ('receipt','advance','refund','void','cancel')),
  amount_paise bigint NOT NULL CHECK (amount_paise <> 0),
  refund_id    uuid REFERENCES app.refunds(id) ON DELETE RESTRICT,
  created_by   uuid REFERENCES app.staff_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((amount_paise > 0) = (kind IN ('receipt','advance'))),
  CHECK ((refund_id IS NOT NULL) = (kind = 'refund'))
);
CREATE INDEX payment_allocations_payment_idx ON app.payment_allocations (tenant_id, payment_id);
CREATE INDEX payment_allocations_invoice_idx ON app.payment_allocations (tenant_id, invoice_id);
SELECT app.set_tenant_isolation('app.payment_allocations');
REVOKE UPDATE, DELETE ON app.payment_allocations FROM app_runtime, app_platform;

-- docs/02 §9 invariant 4: status follows paid vs total, never set by hand.
-- Overdue is worked out on read and never stored.
ALTER TABLE app.invoices
  ADD CONSTRAINT invoices_paid_within_total CHECK (paid_paise >= 0 AND paid_paise <= total_paise),
  ADD CONSTRAINT invoices_status_matches_paid CHECK (
    CASE status
      WHEN 'paid'      THEN paid_paise = total_paise
      WHEN 'part_paid' THEN paid_paise > 0 AND paid_paise < total_paise
      ELSE paid_paise = 0
    END);

-- down
ALTER TABLE app.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_matches_paid,
  DROP CONSTRAINT IF EXISTS invoices_paid_within_total;
-- Without allocations nothing is paid: put invoices back as 0014 left them.
UPDATE app.invoices SET paid_paise = 0, status = 'issued' WHERE status IN ('paid','part_paid') AND total_paise > 0;
UPDATE app.invoices SET paid_paise = 0 WHERE paid_paise <> 0;
DROP TABLE IF EXISTS app.payment_allocations;
DROP TABLE IF EXISTS app.refunds;
DROP TABLE IF EXISTS app.payments;
