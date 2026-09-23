-- up
-- docs/02 §7 sessions. Classes may now cross midnight (agreed 2026-09-23):
-- an end time earlier than the start means the next day.

ALTER TABLE app.batch_schedules DROP CONSTRAINT batch_schedules_check;
ALTER TABLE app.batch_schedules ADD CONSTRAINT batch_schedules_times_differ CHECK (end_time <> start_time);

CREATE TABLE app.sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  branch_id     uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  batch_id      uuid NOT NULL REFERENCES app.batches(id) ON DELETE CASCADE,
  coach_id      uuid REFERENCES app.staff_users(id),   -- NULL = the batch's coach; set = substitute
  resource_id   uuid REFERENCES app.resources(id),     -- NULL = the batch's room
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  session_date  date NOT NULL,                         -- LOCAL date the class starts on
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','held','cancelled')),
  cancel_reason text,
  notes         text,
  generated     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, starts_at),                        -- makes generation idempotent
  CHECK (ends_at > starts_at),
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);
CREATE INDEX sessions_day_idx ON app.sessions (tenant_id, session_date, branch_id);
CREATE INDEX sessions_coach_idx ON app.sessions (tenant_id, coach_id, session_date);
CREATE INDEX sessions_batch_idx ON app.sessions (tenant_id, batch_id, starts_at);
SELECT app.set_tenant_isolation('app.sessions');

-- down
DROP TABLE IF EXISTS app.sessions;
ALTER TABLE app.batch_schedules DROP CONSTRAINT IF EXISTS batch_schedules_times_differ;
ALTER TABLE app.batch_schedules ADD CONSTRAINT batch_schedules_check CHECK (end_time > start_time);
