-- up
-- docs/02 §6 enquiries and trials, with what the agreed rules need (docs/03 §4,
-- agreed 2026-09-25): the parent's name, a lost note, and when each stage was
-- first reached, so the funnel report is one query. Nothing here is deleted.
CREATE TABLE app.enquiries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id            uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  name                 text NOT NULL CHECK (length(trim(name)) > 0),
  phone                text NOT NULL,
  contact_name         text,
  email                extensions.citext,
  source               text CHECK (source IN ('walk_in','phone_call','whatsapp','referral','instagram','facebook','google','poster','other')),
  program_id           uuid REFERENCES app.programs(id),
  batch_id             uuid REFERENCES app.batches(id),
  status               text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','trial_booked','trial_done','won','lost')),
  lost_reason          text CHECK (lost_reason IN ('fees','timing','distance','elsewhere','not_interested','no_reply','other')),
  lost_note            text,
  owner_staff_id       uuid REFERENCES app.staff_users(id),
  next_follow_up       date,
  converted_student_id uuid REFERENCES app.students(id),
  notes                text,
  created_by           uuid REFERENCES app.staff_users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  contacted_at         timestamptz,
  trial_booked_at      timestamptz,
  trial_done_at        timestamptz,
  won_at               timestamptz,
  lost_at              timestamptz,
  deleted_at           timestamptz,
  CHECK (status <> 'lost' OR lost_reason IS NOT NULL),
  CHECK (status <> 'won' OR converted_student_id IS NOT NULL)
);
CREATE INDEX enquiries_board_idx ON app.enquiries (tenant_id, status, next_follow_up);
CREATE INDEX enquiries_phone_idx ON app.enquiries (tenant_id, phone);
CREATE INDEX enquiries_created_idx ON app.enquiries (tenant_id, created_at);
SELECT app.set_tenant_isolation('app.enquiries');
REVOKE DELETE ON app.enquiries FROM app_runtime;

-- The timeline: calls, messages, visits, notes and every status change.
CREATE TABLE app.enquiry_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  enquiry_id  uuid NOT NULL REFERENCES app.enquiries(id) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('call','whatsapp','visit','note','status_change')),
  note        text,
  to_status   text,
  staff_id    uuid REFERENCES app.staff_users(id),
  happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enquiry_activities_enquiry_idx ON app.enquiry_activities (tenant_id, enquiry_id, happened_at DESC);
SELECT app.set_tenant_isolation('app.enquiry_activities');
REVOKE UPDATE, DELETE ON app.enquiry_activities FROM app_runtime;

-- A trial in a real class, marked on its roster like a student (mark, not a
-- boolean, so Late shows as Late). A booking is cancelled, never deleted.
CREATE TABLE app.trial_attendances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  enquiry_id   uuid NOT NULL REFERENCES app.enquiries(id) ON DELETE RESTRICT,
  session_id   uuid NOT NULL REFERENCES app.sessions(id) ON DELETE RESTRICT,
  trial_date   date NOT NULL,
  mark         text CHECK (mark IN ('present','absent','late','excused')),
  marked_by    uuid REFERENCES app.staff_users(id),
  marked_at    timestamptz,
  feedback     text,
  created_by   uuid REFERENCES app.staff_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE UNIQUE INDEX trial_attendances_once ON app.trial_attendances (tenant_id, enquiry_id, session_id) WHERE cancelled_at IS NULL;
CREATE INDEX trial_attendances_session_idx ON app.trial_attendances (tenant_id, session_id);
SELECT app.set_tenant_isolation('app.trial_attendances');
REVOKE DELETE ON app.trial_attendances FROM app_runtime;

-- down
DROP TABLE IF EXISTS app.trial_attendances;
DROP TABLE IF EXISTS app.enquiry_activities;
DROP TABLE IF EXISTS app.enquiries;
