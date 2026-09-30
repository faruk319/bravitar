-- up
-- Modules (agreed 2026-09-30): activities are the modules Bravitar sells. Their
-- keys come only from the code registry (src/lib/activities.ts) and a
-- migration; the platform edits names, descriptions, icons and status, never
-- the list or a key.
ALTER TABLE app.activities ADD COLUMN icon text;
UPDATE app.activities SET icon = CASE key
  WHEN 'tuition' THEN 'graduation-cap'
  WHEN 'deeniyat' THEN 'book-open'
  WHEN 'karate' THEN 'shield'
  WHEN 'dance' THEN 'music'
  WHEN 'sports' THEN 'trophy'
  WHEN 'gym' THEN 'dumbbell'
  WHEN 'swimming' THEN 'waves'
  ELSE 'shapes' END;
ALTER TABLE app.activities ALTER COLUMN icon SET NOT NULL;

REVOKE INSERT, UPDATE, DELETE ON app.activities FROM app_platform;
GRANT UPDATE (name, description, icon, status, updated_at) ON app.activities TO app_platform;

-- The plan a new start gets when none is picked: one per module, on offer.
-- The cheapest offered plan becomes it (Starter; Free for Deeniyat).
ALTER TABLE app.activity_plans ADD COLUMN is_default boolean NOT NULL DEFAULT false;
UPDATE app.activity_plans p SET is_default = true
 WHERE p.id = (SELECT q.id FROM app.activity_plans q WHERE q.activity_key = p.activity_key AND q.is_offered ORDER BY q.price_paise, q.name LIMIT 1);
ALTER TABLE app.activity_plans ADD CONSTRAINT activity_plans_default_offered CHECK (NOT is_default OR is_offered);
CREATE UNIQUE INDEX activity_plans_default_uq ON app.activity_plans (activity_key) WHERE is_default;

-- down
DROP INDEX app.activity_plans_default_uq;
ALTER TABLE app.activity_plans DROP CONSTRAINT activity_plans_default_offered;
ALTER TABLE app.activity_plans DROP COLUMN is_default;
REVOKE UPDATE (name, description, icon, status, updated_at) ON app.activities FROM app_platform;
GRANT INSERT, UPDATE, DELETE ON app.activities TO app_platform;
ALTER TABLE app.activities DROP COLUMN icon;
