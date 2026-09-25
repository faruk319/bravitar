-- up
-- A trial event (booked, cancelled, came, missed) is one timeline entry of its
-- own kind, with the status it led to in to_status, instead of reading as the
-- status it fell back to (agreed 2026-09-25).
ALTER TABLE app.enquiry_activities DROP CONSTRAINT enquiry_activities_kind_check;
ALTER TABLE app.enquiry_activities ADD CONSTRAINT enquiry_activities_kind_check CHECK (kind IN ('call','whatsapp','visit','note','status_change','trial'));

-- down
UPDATE app.enquiry_activities SET kind = CASE WHEN to_status IS NULL THEN 'note' ELSE 'status_change' END WHERE kind = 'trial';
ALTER TABLE app.enquiry_activities DROP CONSTRAINT enquiry_activities_kind_check;
ALTER TABLE app.enquiry_activities ADD CONSTRAINT enquiry_activities_kind_check CHECK (kind IN ('call','whatsapp','visit','note','status_change'));
