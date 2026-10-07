import { describe, expect, it } from "vitest";
import { moduleFlags } from "./can";
import { COACH_NAV, coachNavFor, crumbsFor, isParent, NAV_GROUPS, navFor } from "./nav";
import { PRESET_ROLES } from "./permissions";

const all = moduleFlags({ students: true, batches: true, attendance: true, fees: true, enquiries: true, messaging: true, reports: true });
const flat = (groups: ReturnType<typeof navFor>) => groups.flatMap((g) => g.items.flatMap((e) => (isParent(e) ? e.children : [e])));
const hrefs = (groups: ReturnType<typeof navFor>) => flat(groups).map((i) => i.href);
const finance = (groups: ReturnType<typeof navFor>) => groups.flatMap((g) => g.items).find((e) => isParent(e));
const as = (permissions: string[]) => navFor({ isOwner: false, modules: all, permissions });

describe("navFor", () => {
  it("an owner sees every item in docs/07 order", () => {
    const groups = navFor({ isOwner: true, modules: all, permissions: [] });
    expect(groups.map((g) => g.title)).toEqual(["Main", "Academy"]);
    expect(hrefs(groups)).toEqual(hrefs(NAV_GROUPS));
    expect(hrefs(groups)).toEqual([
      "/dashboard", "/today", "/attendance", "/students", "/enquiries", "/batches/programs", "/batches",
      "/invoices", "/payments", "/payments/new", "/fee-plans", "/reports",
      "/staff", "/messages", "/settings", "/billing",
    ]);
  });

  it("a Front Desk sees people and collection, not staff, reports or setup", () => {
    const groups = navFor({ isOwner: false, modules: all, permissions: PRESET_ROLES["Front Desk"].permissions });
    const h = hrefs(groups);
    expect(h).toEqual(expect.arrayContaining(["/students", "/enquiries", "/invoices", "/payments/new"]));
    expect(h).not.toContain("/attendance"); // marks, but does not hold attendance:read
    expect(h).not.toContain("/staff");
    expect(h).not.toContain("/reports");
    expect(h).not.toContain("/settings");
    expect(groups.map((g) => g.title)).toEqual(["Main"]);
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
    expect(groups.map((g) => [g.title, hrefs([g])])).toEqual([["Main", ["/dashboard", "/students"]]]);
  });

  it("drops the Finance parent when every child is refused", () => {
    const groups = as(["students:read"]);
    expect(finance(groups)).toBeUndefined();
    expect(hrefs(groups)).not.toContain("/invoices");
  });

  it("collapses Finance into a plain link when exactly one child is permitted", () => {
    const groups = as(["fee_plans:manage"]);
    expect(finance(groups)).toBeUndefined();
    const entry = groups[0]?.items.find((e) => !isParent(e) && e.href === "/fee-plans");
    expect(entry).toMatchObject({ href: "/fee-plans", label: { text: "Fee plans" } });
  });

  it("keeps Finance with only the permitted children when two or more remain", () => {
    const parent = finance(as(["invoices:read", "payments:read", "fees:collect"]));
    expect(parent && isParent(parent) ? parent.children.map((c) => c.href) : null).toEqual(["/invoices", "/payments", "/payments/new"]);
  });

  it("keeps the Finance parent between Batches and Reports", () => {
    const items = navFor({ isOwner: true, modules: all, permissions: [] })[0]?.items ?? [];
    const at = items.findIndex((e) => isParent(e));
    expect(items[at - 1]).toMatchObject({ href: "/batches" });
    expect(items[at + 1]).toMatchObject({ href: "/reports" });
  });

  it("keeps the label keys so each academy's own wording shows", () => {
    expect(flat(navFor({ isOwner: true, modules: all, permissions: [] })).filter((i) => "labelKey" in i.label).map((i) => [i.href, "labelKey" in i.label ? i.label.labelKey : ""])).toEqual([
      ["/today", "session"],
      ["/students", "student"],
      ["/batches", "batch"],
      ["/staff", "staff"],
    ]);
  });
});

describe("coachNavFor", () => {
  it("a Teacher gets exactly Today, Students, Me", () => {
    expect(coachNavFor({ isOwner: false, modules: all, permissions: PRESET_ROLES.Teacher.permissions }).map((i) => i.href)).toEqual(["/today", "/students", "/me"]);
    expect(COACH_NAV).toHaveLength(3);
  });
});

describe("crumbsFor", () => {
  it("has none on the dashboard", () => {
    expect(crumbsFor("/dashboard")).toEqual([]);
  });

  it("a top-level page is one crumb, not a link", () => {
    expect(crumbsFor("/students")).toEqual([{ label: { labelKey: "student", form: "many" }, href: null }]);
  });

  it("an entity route links its section and ends in the supplied name", () => {
    expect(crumbsFor("/students/123", "Aarav Sharma")).toEqual([
      { label: { labelKey: "student", form: "many" }, href: "/students" },
      { label: { text: "Aarav Sharma" }, href: null },
    ]);
  });

  it("an entity route without a name stops at its section, never a placeholder", () => {
    expect(crumbsFor("/students/123")).toEqual([{ label: { labelKey: "student", form: "many" }, href: "/students" }]);
  });

  it("static subroutes carry their own title and never an ellipsis", () => {
    expect(crumbsFor("/batches/calendar").at(-1)).toEqual({ label: { text: "Calendar" }, href: null });
    expect(crumbsFor("/students/import").at(-1)).toEqual({ label: { labelKey: "student", form: "many", prefix: "Import " }, href: null });
    expect(crumbsFor("/reports/dues")).toEqual([
      { label: { text: "Reports" }, href: "/reports" },
      { label: { text: "Outstanding dues" }, href: null },
    ]);
    for (const path of ["/batches/holidays", "/batches/new", "/students/new", "/staff/roles", "/reports/at-risk"]) {
      expect(JSON.stringify(crumbsFor(path))).not.toContain("…");
    }
  });

  it("a named page under a static subroute keeps the subroute as a link", () => {
    expect(crumbsFor("/staff/roles/9", "Accountant")).toEqual([
      { label: { labelKey: "staff", form: "many" }, href: "/staff" },
      { label: { text: "Roles" }, href: "/staff/roles" },
      { label: { text: "Accountant" }, href: null },
    ]);
  });

  it("/payments/new is Collect payment under Finance, not Collections", () => {
    expect(crumbsFor("/payments/new")).toEqual([
      { label: { text: "Finance" }, href: null },
      { label: { text: "Collect payment" }, href: null },
    ]);
  });

  it("a receipt sits under Finance > Collections", () => {
    expect(crumbsFor("/payments/0192-abc", "Receipt 7")).toEqual([
      { label: { text: "Finance" }, href: null },
      { label: { text: "Collections" }, href: "/payments" },
      { label: { text: "Receipt 7" }, href: null },
    ]);
  });

  it("/batches/programs is Courses & Programs, not Batches", () => {
    expect(crumbsFor("/batches/programs")).toEqual([{ label: { text: "Courses & Programs" }, href: null }]);
  });

  it("an unknown path gives no crumbs instead of throwing", () => {
    expect(crumbsFor("/nowhere/at/all")).toEqual([]);
    expect(crumbsFor("")).toEqual([]);
  });
});
