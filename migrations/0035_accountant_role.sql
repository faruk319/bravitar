-- up
-- An Accountant preset (agreed 2026-10-02) for academies made before it.
-- New academies get it from PRESET_ROLES; one that already has a role with
-- this name keeps its own. The owner can edit it like any role.

CREATE TEMP TABLE made (id uuid, tenant_id uuid) ON COMMIT DROP;

WITH added AS (
  INSERT INTO app.roles (tenant_id, name)
  SELECT t.id, 'Accountant' FROM app.tenants t
   WHERE NOT EXISTS (SELECT 1 FROM app.roles r WHERE r.tenant_id = t.id AND r.name = 'Accountant')
  RETURNING id, tenant_id
)
INSERT INTO made SELECT id, tenant_id FROM added;

INSERT INTO app.role_permissions (tenant_id, role_id, permission_key)
SELECT m.tenant_id, m.id, k
  FROM made m,
       unnest(ARRAY['students:read', 'students:read_all', 'invoices:read', 'invoices:manage', 'fees:collect', 'payments:read', 'fee_plans:manage', 'reports:view', 'reports:export']) AS k;

INSERT INTO app.audit_log (tenant_id, actor_type, action, entity_type, entity_id, after)
SELECT tenant_id, 'system', 'role.create', 'role', id, jsonb_build_object('name', 'Accountant', 'preset', true) FROM made;

-- down
-- Only the roles this migration made, and only while nobody holds them.
DELETE FROM app.role_permissions rp USING app.roles r
 WHERE r.id = rp.role_id AND r.name = 'Accountant' AND NOT EXISTS (SELECT 1 FROM app.staff_roles sr WHERE sr.role_id = r.id)
   AND EXISTS (SELECT 1 FROM app.audit_log a WHERE a.entity_id = r.id AND a.action = 'role.create' AND a.after ->> 'preset' = 'true');
DELETE FROM app.roles r
 WHERE r.name = 'Accountant' AND NOT EXISTS (SELECT 1 FROM app.staff_roles sr WHERE sr.role_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM app.role_permissions rp WHERE rp.role_id = r.id)
   AND EXISTS (SELECT 1 FROM app.audit_log a WHERE a.entity_id = r.id AND a.action = 'role.create' AND a.after ->> 'preset' = 'true');
