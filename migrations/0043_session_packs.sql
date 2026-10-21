-- up
-- Prepaid session packs (finance spec, addendum 2026-10-21). A pack is sold with
-- its invoice at the desk; what it has used is derived from attendance, never stored.
-- Only the expiry and its reason ever change, and a pack is never deleted.

CREATE TABLE app.session_packs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  enrollment_id   uuid NOT NULL REFERENCES app.enrollments(id) ON DELETE RESTRICT,
  student_id      uuid NOT NULL REFERENCES app.students(id) ON DELETE RESTRICT,
  invoice_id      uuid NOT NULL UNIQUE REFERENCES app.invoices(id) ON DELETE RESTRICT,
  sessions        integer NOT NULL CHECK (sessions > 0),
  valid_from      date NOT NULL,
  valid_until     date NOT NULL,              -- the last day it can be used
  extended_reason text CHECK (extended_reason IS NULL OR length(trim(extended_reason)) > 0),
  created_by      uuid REFERENCES app.staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until >= valid_from)
);
CREATE INDEX session_packs_enrollment_idx ON app.session_packs (tenant_id, enrollment_id, valid_from);
SELECT app.set_tenant_isolation('app.session_packs');
REVOKE UPDATE, DELETE ON app.session_packs FROM app_runtime, app_platform;
GRANT UPDATE (valid_until, extended_reason) ON app.session_packs TO app_runtime, app_platform;

-- down
DROP TABLE IF EXISTS app.session_packs;
