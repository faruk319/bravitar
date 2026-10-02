-- up
-- One role per staff member (agreed 2026-10-02). Owners keep just the Owner
-- role: is_owner already gives them everything. Anyone else with several roles
-- gets one combined role holding all their permissions, so nobody loses
-- access; each change is in the academy's audit log.

DELETE FROM app.staff_roles sr
 USING app.staff_users u, app.roles r
 WHERE u.id = sr.staff_id AND r.id = sr.role_id AND u.is_owner AND NOT r.is_system
   AND EXISTS (SELECT 1 FROM app.staff_roles o JOIN app.roles s ON s.id = o.role_id WHERE o.staff_id = sr.staff_id AND s.is_system);

CREATE TEMP TABLE multi ON COMMIT DROP AS
  SELECT sr.tenant_id, sr.staff_id, array_agg(sr.role_id ORDER BY sr.role_id) AS role_ids, string_agg(r.name, ' + ' ORDER BY r.name) AS names
    FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id
   GROUP BY sr.tenant_id, sr.staff_id
  HAVING count(*) > 1;

DO $$
DECLARE
  c record;
  made uuid;
BEGIN
  FOR c IN SELECT DISTINCT tenant_id, role_ids, names FROM multi LOOP
    INSERT INTO app.roles (tenant_id, name)
    VALUES (c.tenant_id, CASE WHEN EXISTS (SELECT 1 FROM app.roles WHERE tenant_id = c.tenant_id AND name = c.names) THEN c.names || ' (combined)' ELSE c.names END)
    RETURNING id INTO made;
    INSERT INTO app.role_permissions (tenant_id, role_id, permission_key)
      SELECT DISTINCT c.tenant_id, made, permission_key FROM app.role_permissions WHERE role_id = ANY (c.role_ids);
    DELETE FROM app.staff_roles sr USING multi m WHERE m.tenant_id = c.tenant_id AND m.role_ids = c.role_ids AND sr.staff_id = m.staff_id;
    INSERT INTO app.staff_roles (tenant_id, staff_id, role_id)
      SELECT c.tenant_id, m.staff_id, made FROM multi m WHERE m.tenant_id = c.tenant_id AND m.role_ids = c.role_ids;
    INSERT INTO app.audit_log (tenant_id, actor_type, action, entity_type, entity_id, before, after)
      SELECT c.tenant_id, 'system', 'staff.role.set', 'staff_user', m.staff_id, jsonb_build_object('roleIds', to_jsonb(c.role_ids)), jsonb_build_object('roleId', made)
        FROM multi m WHERE m.tenant_id = c.tenant_id AND m.role_ids = c.role_ids;
  END LOOP;
END $$;

CREATE UNIQUE INDEX staff_roles_one_per_staff ON app.staff_roles (staff_id);

-- down
-- The combined roles stay: they can't be split back.
DROP INDEX IF EXISTS app.staff_roles_one_per_staff;
