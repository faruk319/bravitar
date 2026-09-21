import { describe, expect, it } from "vitest";
import { MODULES, PERMISSION_KEYS, PERMISSIONS, permissionsFor, PRESET_ROLES } from "./permissions";

describe("permission catalog", () => {
  it("uses module:action keys whose module is known", () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z_]+:[a-z_]+$/);
      expect(MODULES).toContain(PERMISSIONS[key].module);
    }
  });

  it("contains every key the specs name explicitly", () => {
    for (const k of ["students:read", "students:read_all", "sessions:read", "sessions:note", "attendance:mark", "attendance:amend", "fees:collect", "fees:refund", "invoices:read", "staff:manage", "integrations:manage", "reports:view"]) {
      expect(PERMISSION_KEYS).toContain(k);
    }
  });
});

describe("preset roles (docs/03 §2)", () => {
  it("Owner is a system role with no rows; access comes from is_owner", () => {
    expect(PRESET_ROLES.Owner).toEqual({ isSystem: true, permissions: [] });
  });

  it("Manager has everything except staff:manage, integrations:manage, fees:refund", () => {
    const m = PRESET_ROLES.Manager.permissions;
    expect(m).toHaveLength(PERMISSION_KEYS.length - 3);
    expect(m).not.toContain("staff:manage");
    expect(m).not.toContain("integrations:manage");
    expect(m).not.toContain("fees:refund");
    expect(m).toContain("fees:collect");
  });

  it("Teacher has exactly the four keys", () => {
    expect([...PRESET_ROLES.Teacher.permissions].sort()).toEqual(["attendance:mark", "sessions:note", "sessions:read", "students:read"]);
  });

  it("Front Desk has students:*, enquiries:*, fees:collect, invoices:read, attendance:mark", () => {
    const fd = PRESET_ROLES["Front Desk"].permissions;
    for (const k of [...permissionsFor("students"), ...permissionsFor("enquiries")]) expect(fd).toContain(k);
    expect(fd).toContain("fees:collect");
    expect(fd).toContain("invoices:read");
    expect(fd).toContain("attendance:mark");
    expect(fd).not.toContain("fees:refund");
    expect(fd).toHaveLength(permissionsFor("students").length + permissionsFor("enquiries").length + 3);
  });

  it("every preset key exists in the catalog", () => {
    for (const role of Object.values(PRESET_ROLES)) for (const k of role.permissions) expect(PERMISSION_KEYS).toContain(k);
  });
});
