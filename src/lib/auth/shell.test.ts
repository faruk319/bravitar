import { describe, expect, it } from "vitest";
import { PRESET_ROLES } from "./permissions";
import { homeFor, shellFor } from "./shell";

describe("shellFor", () => {
  it("owners always get the admin shell", () => {
    expect(shellFor({ isOwner: true, permissions: [] })).toBe("admin");
  });
  it("a Teacher preset gets the coach shell", () => {
    expect(shellFor({ isOwner: false, permissions: PRESET_ROLES.Teacher.permissions })).toBe("coach");
  });
  it("Manager and Front Desk get the admin shell", () => {
    expect(shellFor({ isOwner: false, permissions: PRESET_ROLES.Manager.permissions })).toBe("admin");
    expect(shellFor({ isOwner: false, permissions: PRESET_ROLES["Front Desk"].permissions })).toBe("admin");
  });
  it("one extra permission moves a coach to the admin shell", () => {
    expect(shellFor({ isOwner: false, permissions: [...PRESET_ROLES.Teacher.permissions, "fees:collect"] })).toBe("admin");
  });
  it("homes differ per shell", () => {
    expect(homeFor("coach")).toBe("/today");
    expect(homeFor("admin")).toBe("/dashboard");
  });
});
