-- up
-- docs/02 §8. Unmarked = no row; rows are changed, never deleted.
CREATE TABLE app.attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  session_id  uuid NOT NULL REFERENCES app.sessions(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES app.students(id) ON DELETE RESTRICT,
  status      text NOT NULL CHECK (status IN ('present','absent','late','excused')),
  marked_by   uuid REFERENCES app.staff_users(id),
  marked_at   timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','offline_sync','portal','kiosk')),
  note        text,
  UNIQUE (session_id, student_id)
);
CREATE INDEX attendance_student_idx ON app.attendance (tenant_id, student_id, marked_at DESC);
SELECT app.set_tenant_isolation('app.attendance');

-- down
DROP TABLE IF EXISTS app.attendance;
