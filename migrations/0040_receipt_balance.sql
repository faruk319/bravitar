-- up
-- What the payer still owed in the branch once this payment was recorded, so a
-- reprint never changes (finance module spec, "Receipt"). NULL on receipts made
-- before this. The column grant in 0015 keeps it un-updatable by the app roles.

ALTER TABLE app.payments ADD COLUMN balance_after_paise bigint CHECK (balance_after_paise >= 0);

-- down
ALTER TABLE app.payments DROP COLUMN balance_after_paise;
