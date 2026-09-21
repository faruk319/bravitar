-- up
-- docs/02-data-model.md §4 (staff and RBAC). sessions_auth and otp_codes come
-- with the auth slice.

-- Global catalog, synced from src/lib/auth/permissions.ts. Tenants read it;
-- only the platform role (and the migrator) may change it.
CREATE TABLE app.permissions (
  key         text PRIMARY KEY,
  module      text NOT NULL,
  description text NOT NULL
);
REVOKE INSERT, UPDATE, DELETE ON app.permissions FROM app_runtime;

CREATE TABLE app.staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  email         extensions.citext NOT NULL,
  phone         text,
  password_hash text NOT NULL,            -- '!' until a password is set
  full_name     text NOT NULL,
  is_owner      boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, email)
);
CREATE INDEX staff_users_tenant_active_idx ON app.staff_users (tenant_id, is_active) WHERE deleted_at IS NULL;
SELECT app.set_tenant_isolation('app.staff_users');

-- No rows for a staff member = access to all branches.
CREATE TABLE app.staff_branches (
  staff_id  uuid NOT NULL REFERENCES app.staff_users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  PRIMARY KEY (staff_id, branch_id)
);
SELECT app.set_tenant_isolation('app.staff_branches');

CREATE TABLE app.roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  name       text NOT NULL,               -- Owner | Manager | Teacher | Front Desk
  is_system  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
SELECT app.set_tenant_isolation('app.roles');

CREATE TABLE app.role_permissions (
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  role_id        uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES app.permissions(key),
  PRIMARY KEY (role_id, permission_key)
);
SELECT app.set_tenant_isolation('app.role_permissions');

CREATE TABLE app.staff_roles (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  staff_id  uuid NOT NULL REFERENCES app.staff_users(id) ON DELETE CASCADE,
  role_id   uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, role_id)
);
SELECT app.set_tenant_isolation('app.staff_roles');

-- down
DROP TABLE IF EXISTS app.staff_roles;
DROP TABLE IF EXISTS app.role_permissions;
DROP TABLE IF EXISTS app.roles;
DROP TABLE IF EXISTS app.staff_branches;
DROP TABLE IF EXISTS app.staff_users;
DROP TABLE IF EXISTS app.permissions;
