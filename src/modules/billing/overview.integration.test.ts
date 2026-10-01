import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as runtimeSql } from "@/lib/db/client";
import { addTestActivities, removeTestActivities, testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { payToStart } from "./payments";
import { activityPlans } from "./schema";
import { type BillingOverview, billingOverview, editActivity, renewSubscription, setPrice, startActivity } from "./service";

// /platform/billing (agreed 2026-10-01): what academies owe and what is
// overdue, who waits for a first payment, trials ending within a week, special
// prices and the latest payments; asked for this file's academy only.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `test-ovw-${stamp}` as const;
const id = { overdue: "", waiting: "", trial: "", paidToday: "" };
let planId = "";
let A = "";
let today = "";
let o: BillingOverview;

const start = (name: string, on: string, trial = false) =>
  withPlatformAdmin({ action: "test.overview.start", actorType: "system" }, async (tx) => {
    const branch = await createBranch(tx, { tenantId: A, name });
    return startActivity(tx, { tenantId: A, branchId: branch.id, activityKey: KEY, planId, today: on, trial });
  });

beforeAll(async () => {
  await addTestActivities([{ key: KEY, name: "Test overview" }]);
  planId = uuidv7();
  await platformDb.insert(activityPlans).values({ id: planId, activityKey: KEY, name: "Monthly", pricePaise: 50_000n, isOffered: false });
  const a = await testAcademy({ name: `Overview ${stamp}`, slug: `ovw-${stamp}`, owner: { name: "Owner", email: `ovw-${stamp}@example.test` } });
  A = a.tenant.id;
  today = await withTenant(A, tenantToday);

  // Paid on 10 Jan, then February's bill was never paid.
  id.overdue = (await start("Late", "2026-01-10")).id;
  await payToStart(ME, id.overdue, { now: new Date("2026-01-10T12:00:00+05:30") });
  await renewSubscription(id.overdue, "2026-02-10");
  await setPrice(ME, id.overdue, { price: "150", until: addDays(today, 30), reason: "Pilot" });
  id.waiting = (await start("Waiting", today)).id;
  await editActivity(ME, KEY, { name: "Test overview", description: "", icon: "shapes", status: "active", trialDays: "3" });
  id.trial = (await start("Trial", today, true)).id;
  id.paidToday = (await start("Paid today", today)).id;
  await payToStart(ME, id.paidToday);
  o = await billingOverview({ tenantIds: [A] });
});

afterAll(async () => {
  await deleteTenantsCompletely([A].filter(Boolean));
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, [planId].filter(Boolean)));
  await removeTestActivities([KEY]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the billing overview", () => {
  it("lists what is owed, overdue first, and totals it", () => {
    expect(o.owed).toMatchObject([{ academyName: `Overview ${stamp}`, description: "Test overview Monthly · Late", balance: 50_000n, overdue: true }]);
    expect(o).toMatchObject({ overdueCount: 1, overduePaise: 50_000n, owedPaise: 50_000n });
  });

  it("lists who waits for a first payment, trials ending this week, and special prices", () => {
    const ids = (list: { id: string }[]) => list.map((s) => s.id);
    expect(ids(o.waiting)).toEqual([id.waiting]);
    expect(ids(o.endingTrials)).toEqual([id.trial]);
    expect(o.endingTrials.find((s) => s.id === id.trial)?.periodEnd).toBe(addDays(today, 3));
    expect(ids(o.specialPrices)).toEqual([id.overdue]);
  });

  it("counts this month's payments and lists the latest", () => {
    expect(o.payments.map((p) => p.subscriptionId)).toEqual([id.paidToday, id.overdue]); // newest first
    expect(o.receivedPaise).toBe(o.payments[0]?.amountPaise); // January's isn't this month
  });
});
