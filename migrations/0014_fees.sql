-- up
-- docs/02 §9 fee plans, discounts, invoices, with the columns the agreed rules
-- need (docs/03 §8, agreed 2026-09-24).
ALTER TABLE app.tenants
  ADD COLUMN gstin text,
  ADD COLUMN proration text NOT NULL DEFAULT 'full' CHECK (proration IN ('full','daily'));

CREATE TABLE app.fee_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  program_id          uuid REFERENCES app.programs(id),
  name                text NOT NULL,
  kind                text NOT NULL DEFAULT 'recurring' CHECK (kind IN ('recurring','term','package','one_time')),
  billing_cycle       text NOT NULL CHECK (billing_cycle IN ('monthly','quarterly','half_yearly','yearly','one_time')),
  amount_paise        bigint NOT NULL CHECK (amount_paise >= 0),
  admission_fee_paise bigint NOT NULL DEFAULT 0 CHECK (admission_fee_paise >= 0),
  billing_day         smallint NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  grace_days          smallint NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 90),
  late_fee_paise      bigint NOT NULL DEFAULT 0 CHECK (late_fee_paise >= 0),
  tax_rate_bp         integer NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- term: { installments: [...] }
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CHECK ((kind = 'recurring') = (billing_cycle <> 'one_time'))
);
CREATE UNIQUE INDEX fee_plans_name ON app.fee_plans (tenant_id, lower(name)) WHERE deleted_at IS NULL;
SELECT app.set_tenant_isolation('app.fee_plans');

ALTER TABLE app.batches ADD COLUMN default_fee_plan_id uuid REFERENCES app.fee_plans(id);
ALTER TABLE app.enrollments ADD COLUMN fee_plan_id uuid REFERENCES app.fee_plans(id);

CREATE TABLE app.discounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('percent','amount')),
  value      integer NOT NULL CHECK (value >= 0),   -- percent 0-100, or paise
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100)
);
SELECT app.set_tenant_isolation('app.discounts');

CREATE TABLE app.student_discounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  student_id  uuid NOT NULL REFERENCES app.students(id) ON DELETE CASCADE,
  discount_id uuid NOT NULL REFERENCES app.discounts(id) ON DELETE RESTRICT,
  reason      text NOT NULL CHECK (length(trim(reason)) > 0),
  valid_from  date NOT NULL,
  valid_to    date,
  approved_by uuid REFERENCES app.staff_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from - 1)   -- from - 1: ended before it started
);
CREATE INDEX student_discounts_student_idx ON app.student_discounts (tenant_id, student_id);
SELECT app.set_tenant_isolation('app.student_discounts');

-- number / fy are given on issue; a draft has neither.
CREATE TABLE app.invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id      uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  household_id   uuid NOT NULL REFERENCES app.households(id) ON DELETE RESTRICT,
  student_id     uuid REFERENCES app.students(id),      -- NULL for a family invoice
  number         text,
  fy             text,
  period_start   date,
  period_end     date,
  issue_date     date NOT NULL,
  due_date       date NOT NULL,
  subtotal_paise bigint NOT NULL DEFAULT 0,
  discount_paise bigint NOT NULL DEFAULT 0,
  tax_paise      bigint NOT NULL DEFAULT 0,
  total_paise    bigint NOT NULL DEFAULT 0,
  paid_paise     bigint NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','part_paid','paid','overdue','void')),
  void_reason    text,
  issued_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number),
  CHECK ((number IS NULL) = (issued_at IS NULL) AND (number IS NULL) = (fy IS NULL)),
  CHECK (status <> 'draft' OR number IS NULL),
  CHECK (status IN ('draft','void') OR number IS NOT NULL),
  CHECK (status <> 'void' OR void_reason IS NOT NULL),
  CHECK (total_paise = subtotal_paise - discount_paise + tax_paise),
  CHECK (due_date >= issue_date)
);
CREATE INDEX invoices_status_idx ON app.invoices (tenant_id, status, due_date);
CREATE INDEX invoices_household_idx ON app.invoices (tenant_id, household_id, status);
SELECT app.set_tenant_isolation('app.invoices');

-- amount = unit x quantity - discount (before tax). billing_key makes generation
-- idempotent; voiding clears it so the period can be billed again.
CREATE TABLE app.invoice_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  invoice_id     uuid NOT NULL REFERENCES app.invoices(id) ON DELETE CASCADE,
  enrollment_id  uuid REFERENCES app.enrollments(id),
  student_id     uuid REFERENCES app.students(id),
  fee_plan_id    uuid REFERENCES app.fee_plans(id),
  kind           text NOT NULL CHECK (kind IN ('tuition','admission','exam','late_fee','item','other')),
  description    text NOT NULL,
  period_start   date,
  period_end     date,
  quantity       integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_paise     bigint NOT NULL CHECK (unit_paise >= 0),
  discount_paise bigint NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  discount_note  text,
  tax_paise      bigint NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  amount_paise   bigint NOT NULL,
  billing_key    text,
  CHECK (amount_paise = unit_paise * quantity - discount_paise),
  CHECK (discount_paise <= unit_paise * quantity),
  CHECK (discount_paise = 0 OR discount_note IS NOT NULL)
);
CREATE UNIQUE INDEX invoice_lines_billing_key ON app.invoice_lines (tenant_id, billing_key) WHERE billing_key IS NOT NULL;
CREATE INDEX invoice_lines_invoice_idx ON app.invoice_lines (tenant_id, invoice_id);
CREATE INDEX invoice_lines_enrollment_idx ON app.invoice_lines (tenant_id, enrollment_id);
SELECT app.set_tenant_isolation('app.invoice_lines');

-- down
DROP TABLE IF EXISTS app.invoice_lines;
DROP TABLE IF EXISTS app.invoices;
DROP TABLE IF EXISTS app.student_discounts;
DROP TABLE IF EXISTS app.discounts;
ALTER TABLE app.enrollments DROP COLUMN IF EXISTS fee_plan_id;
ALTER TABLE app.batches DROP COLUMN IF EXISTS default_fee_plan_id;
DROP TABLE IF EXISTS app.fee_plans;
ALTER TABLE app.tenants DROP COLUMN IF EXISTS proration, DROP COLUMN IF EXISTS gstin;
