-- up
-- Plans inside an activity (agreed 2026-09-30): Karate Starter, Karate Growth…
-- each with its own price and optional student and staff limits, all edited
-- in /platform/activities. An academy keeps the price it started at; a plan's
-- limits apply to everyone on it. Owners pick from offered plans; the
-- platform may put an academy on any plan.
CREATE TABLE app.activity_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_key     text NOT NULL REFERENCES app.activities(key),
  name             text NOT NULL,
  price_paise      bigint NOT NULL CHECK (price_paise >= 0),
  max_students     integer CHECK (max_students >= 0),
  max_staff        integer CHECK (max_staff >= 0),
  billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month')),
  is_offered       boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, activity_key)
);
CREATE UNIQUE INDEX activity_plans_name_uq ON app.activity_plans (activity_key, lower(name));
REVOKE INSERT, UPDATE, DELETE ON app.activity_plans FROM app_runtime;

-- PLACEHOLDERS: Starter at today's price, Growth at double; Deeniyat is free.
INSERT INTO app.activity_plans (activity_key, name, price_paise, max_students, max_staff)
SELECT key, 'Starter', price_paise, 50, 2 FROM app.activities WHERE key <> 'deeniyat'
UNION ALL
SELECT key, 'Growth', price_paise * 2, 200, 5 FROM app.activities WHERE key <> 'deeniyat'
UNION ALL
SELECT key, 'Free', 0, NULL, NULL FROM app.activities WHERE key = 'deeniyat';

-- Past prices now belong to a plan: the one each activity's price became.
ALTER TABLE app.activity_price_history RENAME TO plan_price_history;
ALTER TABLE app.plan_price_history ADD COLUMN plan_id uuid REFERENCES app.activity_plans(id);
UPDATE app.plan_price_history h SET plan_id = p.id FROM app.activity_plans p WHERE p.activity_key = h.activity_key AND p.name IN ('Starter', 'Free');
ALTER TABLE app.plan_price_history ALTER COLUMN plan_id SET NOT NULL;
DROP INDEX app.activity_price_history_key_idx;
ALTER TABLE app.plan_price_history DROP COLUMN activity_key;
CREATE INDEX plan_price_history_plan_idx ON app.plan_price_history (plan_id, changed_at DESC);

-- Every subscription is on a plan of its own activity; a downgrade waits in
-- next_plan_id for the end of the paid month.
ALTER TABLE app.activity_subscriptions ADD COLUMN plan_id uuid, ADD COLUMN next_plan_id uuid;
UPDATE app.activity_subscriptions s SET plan_id = p.id FROM app.activity_plans p WHERE p.activity_key = s.activity_key AND p.name IN ('Starter', 'Free');
ALTER TABLE app.activity_subscriptions
  ALTER COLUMN plan_id SET NOT NULL,
  ADD FOREIGN KEY (plan_id, activity_key) REFERENCES app.activity_plans (id, activity_key),
  ADD FOREIGN KEY (next_plan_id, activity_key) REFERENCES app.activity_plans (id, activity_key);

ALTER TABLE app.activities DROP COLUMN price_paise, DROP COLUMN billing_interval;

-- down
ALTER TABLE app.activities ADD COLUMN price_paise bigint, ADD COLUMN billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month'));
UPDATE app.activities a SET price_paise = coalesce((SELECT min(p.price_paise) FROM app.activity_plans p WHERE p.activity_key = a.key), 0);
ALTER TABLE app.activities ALTER COLUMN price_paise SET NOT NULL, ADD CHECK (price_paise >= 0);
ALTER TABLE app.activity_subscriptions DROP COLUMN next_plan_id, DROP COLUMN plan_id;
ALTER TABLE app.plan_price_history ADD COLUMN activity_key text REFERENCES app.activities(key);
UPDATE app.plan_price_history h SET activity_key = p.activity_key FROM app.activity_plans p WHERE p.id = h.plan_id;
ALTER TABLE app.plan_price_history ALTER COLUMN activity_key SET NOT NULL;
DROP INDEX app.plan_price_history_plan_idx;
ALTER TABLE app.plan_price_history DROP COLUMN plan_id;
ALTER TABLE app.plan_price_history RENAME TO activity_price_history;
CREATE INDEX activity_price_history_key_idx ON app.activity_price_history (activity_key, changed_at DESC);
DROP TABLE app.activity_plans;
