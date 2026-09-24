-- up
-- Prompt 16 (slice 17): each academy's own Razorpay account (docs/04 "Who
-- receives the money" and "Razorpay payment link flow"; rules in docs/03 §9,
-- agreed 2026-09-25). None of this is used for our own SaaS billing.

-- docs/02 §3. credentials is sealed by src/lib/crypto with the app key and
-- bound to the tenant; config holds only what is safe to show (key id, mode).
CREATE TABLE app.tenant_integrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  kind         text NOT NULL CHECK (kind IN ('razorpay','whatsapp')),
  credentials  bytea NOT NULL,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  connected_at timestamptz,
  connected_by uuid REFERENCES app.staff_users(id),
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind)
);
SELECT app.set_tenant_isolation('app.tenant_integrations');

-- A Razorpay payment link for an invoice. Our id is the reference_id sent to
-- Razorpay. At most one live link per invoice (docs/03 §9).
CREATE TABLE app.payment_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  invoice_id      uuid NOT NULL REFERENCES app.invoices(id) ON DELETE RESTRICT,
  gateway_link_id text NOT NULL,          -- plink_...
  short_url       text NOT NULL,
  amount_paise    bigint NOT NULL CHECK (amount_paise > 0),
  status          text NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','cancelled','expired')),
  created_by      uuid REFERENCES app.staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  UNIQUE (tenant_id, gateway_link_id),
  CHECK ((status = 'created') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX payment_links_live ON app.payment_links (tenant_id, invoice_id) WHERE status = 'created';
CREATE INDEX payment_links_status_idx ON app.payment_links (tenant_id, status, created_at);
SELECT app.set_tenant_isolation('app.payment_links');
-- Only whether it is still live ever changes.
REVOKE UPDATE, DELETE ON app.payment_links FROM app_runtime, app_platform;
GRANT UPDATE (status, closed_at) ON app.payment_links TO app_runtime, app_platform;

-- docs/02 §11 webhook_events, with tenant_id (agreed 2026-09-25): a payload is
-- the academy's data (a parent's contact, amounts), so it sits behind RLS like
-- the rest. The unique index is the idempotency.
CREATE TABLE app.webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  provider          text NOT NULL CHECK (provider IN ('razorpay')),
  provider_event_id text NOT NULL,
  event             text NOT NULL,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  error             text,
  UNIQUE (tenant_id, provider, provider_event_id)
);
CREATE INDEX webhook_events_received_idx ON app.webhook_events (tenant_id, received_at DESC);
SELECT app.set_tenant_isolation('app.webhook_events');
REVOKE UPDATE, DELETE ON app.webhook_events FROM app_runtime, app_platform;
GRANT UPDATE (processed_at, error) ON app.webhook_events TO app_runtime, app_platform;

-- Refunds made in Razorpay are recorded from its webhook, each once.
ALTER TABLE app.refunds ADD COLUMN gateway_refund_id text;
CREATE UNIQUE INDEX refunds_gateway_idx ON app.refunds (tenant_id, gateway_refund_id) WHERE gateway_refund_id IS NOT NULL;

-- down
DROP INDEX IF EXISTS app.refunds_gateway_idx;
ALTER TABLE app.refunds DROP COLUMN IF EXISTS gateway_refund_id;
DROP TABLE IF EXISTS app.webhook_events;
DROP TABLE IF EXISTS app.payment_links;
DROP TABLE IF EXISTS app.tenant_integrations;
