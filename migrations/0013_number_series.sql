-- up
-- docs/02 §9 number_series. One series per academy (agreed 2026-09-24), so no
-- branch_id; a per-branch series would be a later migration.
CREATE TABLE app.number_series (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  kind       text NOT NULL CHECK (kind IN ('invoice','receipt')),
  fy         text NOT NULL,
  prefix     text NOT NULL,
  next_value integer NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  PRIMARY KEY (tenant_id, kind, fy)
);
SELECT app.set_tenant_isolation('app.number_series');

-- down
DROP TABLE IF EXISTS app.number_series;
