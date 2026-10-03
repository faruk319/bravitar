-- up
-- What family members who aren't a student's manager see in the portal
-- (agreed 2026-10-03): all four by default; the owner changes it in Settings.

ALTER TABLE app.tenants
  ADD COLUMN family_access text[] NOT NULL DEFAULT '{attendance,fees,receipts,pay}'
  CONSTRAINT tenants_family_access_check CHECK (family_access <@ ARRAY['attendance', 'fees', 'receipts', 'pay']);

-- down
ALTER TABLE app.tenants DROP COLUMN family_access;
