import { describe, expect, it } from "vitest";
import { moduleFlags } from "./can";
import { COACH_NAV, coachNavFor, NAV_GROUPS, navFor } from "./nav";
import { PRESET_ROLES } from "./permissions";

const all = moduleFlags({ students: true, batches: true, attendance: true, fees: true, enquiries: true, messaging: true, reports: true });
const hrefs = (groups: ReturnType<typeof navFor>) => groups.flatMap((g) => g.items.map((i) => i.href));

describe("navFor", () => {
  it("an owner sees every item in docs/07 order", () => {
    const groups = navFor({ isOwner: true, modules: all, permissions: [] });
    expect(groups.map((g) => g.title)).toEqual(["Daily", "People", "Money", "Setup"]);
    expect(hrefs(groups)).toEqual(hrefs(NAV_GROUPS));
  });

  it("a Front Desk sees people and collection, not staff, reports or setup", () => {
    const groups = navFor({ isOwner: false, modules: all, permissions: PRESET_ROLES["Front Desk"].permissions });
    const h = hrefs(groups);
    expect(h).toEqual(expect.arrayContaining(["/students", "/enquiries", "/invoices", "/payments/new"]));
    expect(h).not.toContain("/attendance"); // marks, but does not hold attendance:read
    expect(h).not.toContain("/staff");
    expect(h).not.toContain("/reports");
    expect(h).not.toContain("/settings");
    expect(groups.map((g) => g.title)).not.toContain("Setup");
  });

  it("a switched-off module hides its items even when the role grants them", () => {
    const groups = navFor({ isOwner: false, modules: { ...all, enquiries: false }, permissions: PRESET_ROLES["Front Desk"].permissions });
    expect(hrefs(groups)).not.toContain("/enquiries");
  });

  it("hides a switched-off module from the owner too", () => {
    expect(hrefs(navFor({ isOwner: true, modules: { ...all, enquiries: false }, permissions: [] }))).not.toContain("/enquiries");
  });

  it("drops a group that ends up empty; the dashboard is for everyone", () => {
    const groups = navFor({ isOwner: false, modules: all, permissions: ["students:read"] });
    expect(groups.map((g) => [g.title, g.items.map((i) => i.href)])).toEqual([
      ["Daily", ["/dashboard"]],
      ["People", ["/students"]],
    ]);
  });
});

describe("coachNavFor", () => {
  it("a Teacher gets exactly Today, Students, Me", () => {
    expect(coachNavFor({ isOwner: false, modules: all, permissions: PRESET_ROLES.Teacher.permissions }).map((i) => i.href)).toEqual(["/today", "/students", "/me"]);
    expect(COACH_NAV).toHaveLength(3);
  });
});
