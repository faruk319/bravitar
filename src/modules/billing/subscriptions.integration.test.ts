import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as runtimeSql } from "@/lib/db/client";
import { addTestActivities, removeTestActivities, testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { createBranch } from "@/modules/tenancy/repo";
import { activityPlans, activitySubscriptions, type BillingInterval, billingInvoices, planPriceHistory } from "./schema";
import { payToStart } from "./payments";
import { allSubscriptions, changePlan, editPlan, renewSubscription, setCancelAtPeriodEnd, startActivity } from "./service";

// Monthly and yearly plans (agreed 2026-09-30): a subscription keeps the cycle
// it started on; moving to another cycle waits for the paid period's end. And
// the platform's list of every branch module.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `test-sub-${stamp}` as const;
const plan = { monthly: "", yearly: "", flex: "" };
let A = "";
let main = "";

const makePlan = async (name: string, price: bigint, billingInterval: BillingInterval, isDefault = false) => {
  const id = uuidv7();
  await platformDb.insert(activityPlans).values({ id, activityKey: KEY, name, pricePaise: price, billingInterval, isDefault });
  return id;
};
const sub = async (id: string) => (await platformRead((tx) => tx.select().from(activitySubscriptions).where(eq(activitySubscriptions.id, id))))[0];
// Paid first on that day, India time (pay first, agreed 2026-09-30).
const start = async (name: string, planId: string, today: string) => {
  const s = await withPlatformAdmin({ action: "test.cycles.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId: A, name });
    return startActivity(tx, { tenantId: A, branchId: branch.id, activityKey: KEY, planId, today, trial: false });
  });
  await payToStart(ME, s.id, { now: new Date(`${today}T12:00:00+05:30`) });
  const paid = await sub(s.id);
  if (!paid) throw new Error("subscription missing");
  return paid;
};
const billsOf = (id: string) =>
  platformRead((tx) =>
    tx
      .select({ periodStart: billingInvoices.periodStart, periodEnd: billingInvoices.periodEnd, subtotalPaise: billingInvoices.subtotalPaise })
      .from(billingInvoices)
      .where(eq(billingInvoices.subscriptionId, id))
      .orderBy(asc(billingInvoices.periodStart)),
  );
const mine = async (f: Parameters<typeof allSubscriptions>[0]) => (await allSubscriptions(f)).rows.filter((r) => r.tenantId === A);

beforeAll(async () => {
  await addTestActivities([{ key: KEY, name: "Test cycles" }]);
  plan.monthly = await makePlan("Monthly", 30_000n, "month", true);
  plan.yearly = await makePlan("Yearly", 300_000n, "year");
  plan.flex = await makePlan("Flex", 50_000n, "month");
  const a = await testAcademy({ name: `Cycles ${stamp}`, slug: `cyc-${stamp}`, owner: { name: "Owner", email: `cyc-${stamp}@example.test` } });
  [A, main] = [a.tenant.id, a.subscription.id];
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

describe("a yearly plan", () => {
  it("bills a year ahead on the anchor day, and again a year later", async () => {
    const s = await start("Leap", plan.yearly, "2028-02-29");
    expect(s).toMatchObject({ billingInterval: "year", anchorDay: 29, periodStart: "2028-02-29", periodEnd: "2029-02-28" });
    await renewSubscription(s.id, "2029-02-28");
    expect((await sub(s.id))?.periodEnd).toBe("2030-02-28");
    expect(await billsOf(s.id)).toEqual([
      { periodStart: "2028-02-29", periodEnd: "2029-02-28", subtotalPaise: 300_000n },
      { periodStart: "2029-02-28", periodEnd: "2030-02-28", subtotalPaise: 300_000n },
    ]);
  });
});

describe("a plan's cycle", () => {
  it("changes for new starts only", async () => {
    const before = await start("Flex before", plan.flex, "2026-03-10");
    await editPlan(ME, plan.flex, { name: "Flex", price: "500", maxStudents: "", maxStaff: "", billingInterval: "year", isOffered: true });
    await renewSubscription(before.id, "2026-04-10");
    expect(await sub(before.id)).toMatchObject({ billingInterval: "month", periodEnd: "2026-05-10" });
    expect((await start("Flex after", plan.flex, "2026-03-10")).billingInterval).toBe("year");
  });

  it("switches at the end of the paid period, then bills the new plan's price for its cycle", async () => {
    const s = await start("Switch", plan.monthly, "2026-05-20");
    expect(await changePlan(ME, s.id, plan.yearly)).toBe("at_period_end"); // dearer, but another cycle
    expect(await sub(s.id)).toMatchObject({ planId: plan.monthly, billingInterval: "month", nextPlanId: plan.yearly });
    await renewSubscription(s.id, "2026-06-20");
    expect(await sub(s.id)).toMatchObject({ planId: plan.yearly, pricePaise: 300_000n, billingInterval: "year", nextPlanId: null, periodEnd: "2027-06-20" });
    expect((await billsOf(s.id)).at(-1)).toEqual({ periodStart: "2026-06-20", periodEnd: "2027-06-20", subtotalPaise: 300_000n });
  });
});

describe("the subscriptions list", () => {
  it("shows live ones, filtered by status and by module; ended ones only when asked", async () => {
    const gone = await start("Gone", plan.monthly, "2026-07-01");
    await setCancelAtPeriodEnd(ME, gone.id, true);
    await renewSubscription(gone.id, "2026-08-01");
    const live = await mine({});
    expect(live.map((r) => r.id)).toContain(main);
    expect(live.map((r) => r.id)).not.toContain(gone.id);
    expect((await mine({ status: "trial" })).map((r) => r.id)).toEqual([main]);
    const cycles = await mine({ activityKey: KEY });
    expect(cycles.length).toBe(live.length - 1);
    expect(cycles.every((r) => r.activityName === "Test cycles" && r.academyName === `Cycles ${stamp}`)).toBe(true);
    expect((await mine({ status: "cancelled" })).map((r) => r.id)).toEqual([gone.id]);
  });
});
