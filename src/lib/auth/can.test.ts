import { describe, expect, it } from "vitest";
import { type AccessContext, assertCan, can, ForbiddenError, moduleFlags } from "./can";

const base: AccessContext = { tenantId: "t", staffId: "s", isOwner: false, modules: moduleFlags({ fees: true, enquiries: false }), permissions: ["fees:collect", "enquiries:create"] };

describe("can", () => {
  it("owner bypasses modules and permissions", () => {
    const owner = { ...base, isOwner: true, modules: {}, permissions: [] };
    expect(can(owner, "fees", "fees:refund")).toBe(true);
    expect(can(owner, "credits", "credits:manage")).toBe(true);
  });

  it("grants a held permission in an enabled module", () => {
    expect(can(base, "fees", "fees:collect")).toBe(true);
  });

  it("refuses a permission the roles do not grant", () => {
    expect(can(base, "fees", "fees:refund")).toBe(false);
  });

  it("refuses a held permission when its module is switched off", () => {
    expect(can(base, "enquiries", "enquiries:create")).toBe(false);
  });

  it("treats core as always on", () => {
    expect(moduleFlags({}).core).toBe(true);
    expect(moduleFlags({ core: false }).core).toBe(true);
    expect(can({ ...base, permissions: ["staff:read"] }, "core", "staff:read")).toBe(true);
  });
});

describe("assertCan", () => {
  it("looks the module up from the catalog and throws a 403 error", () => {
    expect(() => assertCan(base, "fees:collect")).not.toThrow();
    expect(() => assertCan(base, "enquiries:create")).toThrow(ForbiddenError);
    try {
      assertCan(base, "fees:refund");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).status).toBe(403);
      expect((e as ForbiddenError).message).toBe("Not allowed: fees:refund");
    }
  });
});
