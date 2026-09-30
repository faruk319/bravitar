import { and, asc, eq, inArray, like, not } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVITY_KEYS } from "@/lib/activities";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { addTestActivities, removeTestActivities, testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { VERTICAL_PRESETS } from "@/lib/tenant/labels";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { getActivity } from "./repo";
import { activities, activityPlans, activitySubscriptions, planPriceHistory } from "./schema";
import { activityEditSchema, editActivity, editPlan, setDefaultPlan, startActivity } from "./service";

// The modules Bravitar sells (agreed 2026-09-30): the list is the code
// registry's, each module has one default plan on offer, and the platform edits
// names and icons but never the list.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `test-cat-${stamp}` as const;
const plan = { first: "", second: "", hidden: "" };
let A = "";
let today = "";
let onSecond = "";

const makePlan = async (name: string, price: bigint, v: { offered?: boolean; isDefault?: boolean } = {}) => {
  const id = uuidv7();
  await platformDb.insert(activityPlans).values({ id, activityKey: KEY, name, pricePaise: price, isOffered: v.offered ?? true, isDefault: v.isDefault ?? false });
  return id;
};
const start = (name: string) =>
  withPlatformAdmin({ action: "test.catalog.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId: A, name });
    return startActivity(tx, { tenantId: A, branchId: branch.id, activityKey: KEY, today, trial: false });
  });
const defaults = async () =>
  (await platformRead((tx) => tx.select({ id: activityPlans.id }).from(activityPlans).where(and(eq(activityPlans.activityKey, KEY), eq(activityPlans.isDefault, true))))).map((r) => r.id);
const second = (price: string, isOffered: boolean) => ({ name: "Second", price, maxStudents: "", maxStaff: "", isOffered, reason: "Test" });

beforeAll(async () => {
  await addTestActivities([{ key: KEY, name: "Test catalog" }]);
  plan.first = await makePlan("First", 10_000n, { isDefault: true });
  plan.second = await makePlan("Second", 20_000n);
  plan.hidden = await makePlan("Hidden", 5_000n, { offered: false });
  const a = await testAcademy({ name: `Catalog ${stamp}`, slug: `cat-${stamp}`, owner: { name: "Owner", email: `cat-${stamp}@example.test` } });
  A = a.tenant.id;
  today = await withTenant(A, tenantToday);
});

afterAll(async () => {
  await deleteTenantsCompletely([A].filter(Boolean));
  const ids = Object.values(plan).filter(Boolean);
  await platformDb.delete(planPriceHistory).where(inArray(planPriceHistory.planId, ids));
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, ids));
  await removeTestActivities([KEY]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the module catalog", () => {
  it("holds exactly the registry's modules, and every academy type is one of them", async () => {
    const rows = await platformRead((tx) => tx.select({ key: activities.key }).from(activities).where(not(like(activities.key, "test-%"))));
    expect(rows.map((r) => r.key).sort()).toEqual([...ACTIVITY_KEYS].sort());
    for (const type of VERTICAL_PRESETS) expect(ACTIVITY_KEYS).toContain(type);
  });

  it("has at most one default plan per module, always on offer", async () => {
    const rows = await platformRead((tx) => tx.select({ key: activityPlans.activityKey, offered: activityPlans.isOffered }).from(activityPlans).where(eq(activityPlans.isDefault, true)));
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.every((r) => r.offered)).toBe(true);
  });

  it("lets the platform change a module's name and icon, from the icon set only", async () => {
    await editActivity(ME, KEY, { name: "Test module", description: "", icon: "waves", status: "active" });
    expect(await platformRead((tx) => getActivity(tx, KEY))).toMatchObject({ name: "Test module", icon: "waves" });
    expect(activityEditSchema.safeParse({ name: "Test module", description: "", icon: "rocket", status: "active" }).success).toBe(false);
  });
});

describe("the default plan", () => {
  it("is what a start gets when none is picked, and moves when another is made default", async () => {
    expect((await start("One")).planId).toBe(plan.first);
    await setDefaultPlan(ME, plan.second);
    expect(await defaults()).toEqual([plan.second]);
    const s = await start("Two");
    expect(s).toMatchObject({ planId: plan.second, pricePaise: 20_000n });
    onSecond = s.id;
    const audit = await platformRead((tx) => tx.select({ before: auditLog.before }).from(auditLog).where(and(eq(auditLog.action, "activity_plan.default"), eq(auditLog.entityId, plan.second))).orderBy(asc(auditLog.id)));
    expect(audit).toMatchObject([{ before: { defaultPlanId: plan.first } }]);
  });

  it("must be on offer", async () => {
    await expect(setDefaultPlan(ME, plan.hidden)).rejects.toThrow("Offer Hidden before making it the default");
    await expect(editPlan(ME, plan.second, second("200", false))).rejects.toThrow("Second is the default plan: make another one the default first");
  });

  it("takes a new price for new starts only", async () => {
    await editPlan(ME, plan.second, second("250", true));
    expect((await start("Three")).pricePaise).toBe(25_000n);
    const [before] = await platformRead((tx) => tx.select({ price: activitySubscriptions.pricePaise }).from(activitySubscriptions).where(eq(activitySubscriptions.id, onSecond)));
    expect(before?.price).toBe(20_000n);
  });
});
