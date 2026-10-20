-- up
-- Who created an invoice and who issued it (finance module spec, "Invoice
-- detail"). NULL: the nightly run created it, a draft isn't issued yet, or it was
-- made before this.

ALTER TABLE app.invoices
  ADD COLUMN created_by uuid REFERENCES app.staff_users(id),
  ADD COLUMN issued_by uuid REFERENCES app.staff_users(id);

-- down
ALTER TABLE app.invoices
  DROP COLUMN created_by,
  DROP COLUMN issued_by;
