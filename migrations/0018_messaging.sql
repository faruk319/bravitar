-- up
-- docs/02 §10 message templates and log, with what the agreed rules need
-- (docs/03 §10, agreed 2026-09-25): opt-in per guardian, send hours, a daily cap.
ALTER TABLE app.tenants
  ADD COLUMN message_send_hour smallint NOT NULL DEFAULT 10 CHECK (message_send_hour BETWEEN 7 AND 21),
  ADD COLUMN absence_send_hour smallint NOT NULL DEFAULT 19 CHECK (absence_send_hour BETWEEN 7 AND 21),
  ADD COLUMN message_daily_cap integer NOT NULL DEFAULT 250 CHECK (message_daily_cap BETWEEN 1 AND 100000);

ALTER TABLE app.guardians
  ADD COLUMN whatsapp_optin boolean NOT NULL DEFAULT false,
  ADD COLUMN whatsapp_optin_at timestamptz;

-- The academy's own wording per template and language; without a row the
-- default in code is used.
CREATE TABLE app.message_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  key                    text NOT NULL CHECK (key IN ('fee_due','fee_overdue','receipt','absent','class_cancelled','welcome')),
  channel                text NOT NULL DEFAULT 'whatsapp' CHECK (channel = 'whatsapp'),
  language               text NOT NULL CHECK (language IN ('en','hi','mr')),
  body                   text NOT NULL CHECK (length(trim(body)) > 0),
  provider_template_name text,                    -- the name Meta approved
  is_active              boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid REFERENCES app.staff_users(id),
  UNIQUE (tenant_id, key, language)
);
SELECT app.set_tenant_isolation('app.message_templates');

-- Every automated message: queued, then sent through WhatsApp or by a person
-- (channel 'manual'). dedupe_key makes "never twice" a constraint.
CREATE TABLE app.message_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  guardian_id         uuid REFERENCES app.guardians(id),
  to_phone            text NOT NULL,
  channel             text NOT NULL CHECK (channel IN ('whatsapp','manual')),
  template_key        text NOT NULL,
  category            text NOT NULL CHECK (category IN ('fees','receipts','attendance','classes','welcome')),
  language            text NOT NULL,
  variables           jsonb NOT NULL DEFAULT '{}'::jsonb,
  body                text NOT NULL,
  related_type        text,
  related_id          uuid,
  dedupe_key          text,
  send_after          timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','read','failed','skipped')),
  attempts            integer NOT NULL DEFAULT 0,
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  sent_by             uuid REFERENCES app.staff_users(id)
);
CREATE UNIQUE INDEX message_log_dedupe ON app.message_log (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX message_log_provider ON app.message_log (tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX message_log_created_idx ON app.message_log (tenant_id, created_at DESC);
CREATE INDEX message_log_queue_idx ON app.message_log (tenant_id, status, send_after);
SELECT app.set_tenant_isolation('app.message_log');

ALTER TABLE app.webhook_events DROP CONSTRAINT webhook_events_provider_check;
ALTER TABLE app.webhook_events ADD CONSTRAINT webhook_events_provider_check CHECK (provider IN ('razorpay','whatsapp'));

-- down
DELETE FROM app.webhook_events WHERE provider = 'whatsapp';
ALTER TABLE app.webhook_events DROP CONSTRAINT webhook_events_provider_check;
ALTER TABLE app.webhook_events ADD CONSTRAINT webhook_events_provider_check CHECK (provider IN ('razorpay'));
DROP TABLE IF EXISTS app.message_log;
DROP TABLE IF EXISTS app.message_templates;
ALTER TABLE app.guardians DROP COLUMN IF EXISTS whatsapp_optin_at, DROP COLUMN IF EXISTS whatsapp_optin;
ALTER TABLE app.tenants DROP COLUMN IF EXISTS message_daily_cap, DROP COLUMN IF EXISTS absence_send_hour, DROP COLUMN IF EXISTS message_send_hour;
