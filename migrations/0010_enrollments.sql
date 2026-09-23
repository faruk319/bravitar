-- up
-- docs/02 §7 enrollments. fee_plan_id arrives with the fees migration.
-- An empty range (end = start - 1) means moved or left on the day they joined.
CREATE TABLE app.enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  student_id  uuid NOT NULL REFERENCES app.students(id) ON DELETE RESTRICT,
  batch_id    uuid NOT NULL REFERENCES app.batches(id) ON DELETE RESTRICT,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','left','transferred')),
  start_date  date NOT NULL,
  end_date    date,
  paused_on   date,
  transferred_to_enrollment_id uuid REFERENCES app.enrollments(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date - 1),
  CHECK ((end_date IS NULL) = (status IN ('active','paused'))),
  CHECK ((paused_on IS NOT NULL) = (status = 'paused')),
  CHECK ((transferred_to_enrollment_id IS NOT NULL) = (status = 'transferred'))
);
CREATE INDEX enrollments_batch_idx ON app.enrollments (tenant_id, batch_id, status);
CREATE INDEX enrollments_student_idx ON app.enrollments (tenant_id, student_id, status);
CREATE UNIQUE INDEX enrollments_open_once ON app.enrollments (student_id, batch_id) WHERE status IN ('active','paused');
SELECT app.set_tenant_isolation('app.enrollments');

-- Front Desk enrolls students (agreed 2026-09-23).
INSERT INTO app.role_permissions (tenant_id, role_id, permission_key)
SELECT tenant_id, id, 'enrollments:manage' FROM app.roles WHERE name = 'Front Desk'
ON CONFLICT DO NOTHING;

-- down
DELETE FROM app.role_permissions rp USING app.roles r
WHERE rp.role_id = r.id AND r.name = 'Front Desk' AND rp.permission_key = 'enrollments:manage';
DROP TABLE IF EXISTS app.enrollments;
