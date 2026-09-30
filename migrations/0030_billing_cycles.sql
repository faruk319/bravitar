-- up
-- Monthly and yearly plans (agreed 2026-09-30). A subscription keeps the cycle
-- it started on, like its price; moving to a plan with another cycle waits for
-- the end of the paid period.
ALTER TABLE app.activity_plans DROP CONSTRAINT activity_plans_billing_interval_check;
ALTER TABLE app.activity_plans ADD CONSTRAINT activity_plans_billing_interval_check CHECK (billing_interval IN ('month','year'));

ALTER TABLE app.activity_subscriptions ADD COLUMN billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month','year'));
ALTER TABLE app.activity_subscriptions ALTER COLUMN billing_interval DROP DEFAULT;

-- down
-- Refused while anything is yearly: going back would bill a year's price monthly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.activity_plans WHERE billing_interval = 'year')
     OR EXISTS (SELECT 1 FROM app.activity_subscriptions WHERE billing_interval = 'year') THEN
    RAISE EXCEPTION 'yearly plans or subscriptions exist; move them to monthly first';
  END IF;
END $$;
ALTER TABLE app.activity_subscriptions DROP COLUMN billing_interval;
ALTER TABLE app.activity_plans DROP CONSTRAINT activity_plans_billing_interval_check;
ALTER TABLE app.activity_plans ADD CONSTRAINT activity_plans_billing_interval_check CHECK (billing_interval IN ('month'));
