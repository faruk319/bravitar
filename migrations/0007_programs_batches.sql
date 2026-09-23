-- up
-- docs/02-data-model.md §7: programs, batches, weekly schedule rules, holidays.
-- batches.default_fee_plan_id arrives with the fees migration (forward FK).

CREATE TABLE app.programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX programs_name_unique ON app.programs (tenant_id, lower(name)) WHERE deleted_at IS NULL;
SELECT app.set_tenant_isolation('app.programs');

CREATE TABLE app.batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id       uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  program_id      uuid NOT NULL REFERENCES app.programs(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  coach_id        uuid REFERENCES app.staff_users(id),
  resource_id     uuid REFERENCES app.resources(id),
  capacity        integer CHECK (capacity IS NULL OR capacity > 0),
  enrollment_mode text NOT NULL DEFAULT 'roster' CHECK (enrollment_mode IN ('roster','booking')),
  start_date      date NOT NULL,
  end_date        date,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX batches_branch_status_idx ON app.batches (tenant_id, branch_id, status) WHERE deleted_at IS NULL;
CREATE INDEX batches_coach_idx ON app.batches (tenant_id, coach_id) WHERE deleted_at IS NULL;
SELECT app.set_tenant_isolation('app.batches');

-- One row per weekday per version. Times are LOCAL to the tenant's timezone.
-- A timing change ends the old rows the day before and starts new ones.
CREATE TABLE app.batch_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  batch_id       uuid NOT NULL REFERENCES app.batches(id) ON DELETE CASCADE,
  weekday        smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  CHECK (end_time > start_time),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX batch_schedules_batch_idx ON app.batch_schedules (tenant_id, batch_id, effective_from);
SELECT app.set_tenant_isolation('app.batch_schedules');

-- branch_id NULL = all branches; NULLS NOT DISTINCT keeps that unique too.
CREATE TABLE app.holidays (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id  uuid REFERENCES app.branches(id),
  date       date NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, branch_id, date)
);
CREATE INDEX holidays_date_idx ON app.holidays (tenant_id, date);
SELECT app.set_tenant_isolation('app.holidays');

-- down
DROP TABLE IF EXISTS app.holidays;
DROP TABLE IF EXISTS app.batch_schedules;
DROP TABLE IF EXISTS app.batches;
DROP TABLE IF EXISTS app.programs;
