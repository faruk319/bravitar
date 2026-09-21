-- up
-- docs/02-data-model.md §5 (people) plus the slice 6 addendum: code prefix on
-- the tenant, a per-tenant per-year code counter, and code_edited_at.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE app.tenants ADD COLUMN code_prefix text NOT NULL DEFAULT 'STU'
  CHECK (code_prefix ~ '^[A-Z]{2,5}$');

-- The billing unit. An adult student is their own household.
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

CREATE TABLE app.guardians (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  household_id  uuid NOT NULL REFERENCES app.households(id) ON DELETE RESTRICT,
  full_name     text NOT NULL,
  phone         text NOT NULL,           -- E.164, the portal login identifier
  email         extensions.citext,
  can_login     boolean NOT NULL DEFAULT true,
  is_primary    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, phone)
);
CREATE INDEX guardians_household_idx ON app.guardians (tenant_id, household_id);
CREATE INDEX guardians_name_trgm_idx ON app.guardians USING gin (full_name extensions.gin_trgm_ops);
SELECT app.set_tenant_isolation('app.guardians');

CREATE TABLE app.students (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id      uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  household_id   uuid NOT NULL REFERENCES app.households(id) ON DELETE RESTRICT,
  code           text NOT NULL,          -- SKA/2026/0001
  code_edited_at timestamptz,            -- editable once, then locked
  full_name      text NOT NULL,
  date_of_birth  date,
  gender         text,
  phone          text,                   -- adult students only
  photo_key      text,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','paused','left','prospect')),
  joined_on      date NOT NULL DEFAULT CURRENT_DATE,
  left_on        date,
  left_reason    text CHECK (left_reason IN ('moved_away','fees','timing','lost_interest','completed','health','other')),
  left_note      text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  UNIQUE (tenant_id, code)
);
CREATE INDEX students_branch_status_idx ON app.students (tenant_id, branch_id, status) WHERE deleted_at IS NULL;
CREATE INDEX students_household_idx ON app.students (tenant_id, household_id);
CREATE INDEX students_name_trgm_idx ON app.students USING gin (full_name extensions.gin_trgm_ops);
SELECT app.set_tenant_isolation('app.students');

CREATE TABLE app.student_guardians (
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  student_id  uuid NOT NULL REFERENCES app.students(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES app.guardians(id) ON DELETE CASCADE,
  relation    text NOT NULL CHECK (relation IN ('father','mother','self','other')),
  PRIMARY KEY (student_id, guardian_id)
);
SELECT app.set_tenant_isolation('app.student_guardians');

CREATE TABLE app.consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  student_id    uuid NOT NULL REFERENCES app.students(id) ON DELETE CASCADE,
  guardian_id   uuid REFERENCES app.guardians(id),
  kind          text NOT NULL CHECK (kind IN ('data_processing','photo','medical','waiver')),
  granted       boolean NOT NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  granted_ip    inet,
  method        text NOT NULL,           -- 'portal' | 'paper' | 'staff_recorded'
  document_key  text,
  revoked_at    timestamptz
);
CREATE INDEX consents_student_idx ON app.consents (tenant_id, student_id, kind);
SELECT app.set_tenant_isolation('app.consents');

-- Per tenant per calendar year. Allocated with UPDATE ... RETURNING under the
-- row lock, like number_series (docs/01 "Document numbering").
CREATE TABLE app.student_code_series (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  year       smallint NOT NULL,
  next_value integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, year)
);
SELECT app.set_tenant_isolation('app.student_code_series');

-- down
DROP TABLE IF EXISTS app.student_code_series;
DROP TABLE IF EXISTS app.consents;
DROP TABLE IF EXISTS app.student_guardians;
DROP TABLE IF EXISTS app.students;
DROP TABLE IF EXISTS app.guardians;
DROP TABLE IF EXISTS app.households;
ALTER TABLE app.tenants DROP COLUMN IF EXISTS code_prefix;
