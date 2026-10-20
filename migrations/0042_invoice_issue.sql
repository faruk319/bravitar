-- up
-- Whether the nightly run issues the invoices it makes, or leaves them as drafts
-- for the owner to review (finance module spec, "Auto-issue").

ALTER TABLE app.tenants
  ADD COLUMN invoice_issue text NOT NULL DEFAULT 'review'
  CONSTRAINT tenants_invoice_issue_check CHECK (invoice_issue IN ('review', 'auto'));

-- down
ALTER TABLE app.tenants DROP COLUMN invoice_issue;
