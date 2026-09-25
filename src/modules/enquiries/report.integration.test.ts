import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addProgram, createBatch } from "@/modules/batches/service";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { tenantToday } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { convertEnquiry } from "./convert";
import type { Source } from "./lists";
import { createEnquiry, enquiryReport, logActivity, markLost } from "./service";
import { bookTrial } from "./trials";

// docs/03 §4 acceptance: the funnel with count and percentage at each stage
// for a date range, which source converts, and why enquiries are lost.

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let owner: ScopedCtx;
let today = "";
let n = 0;

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Report ${stamp}`, slug: `report-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `report-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, t.owner.id), await staffBranchIds(tx, t.owner.id)] as const);
  owner = { ...base, branchIds };
  today = await withTenant(T, tenantToday);
  const program = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  const batch = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Early", programId: program, slots: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "06:00", endTime: "07:00" })), startDate: today }))).id;
  await withTenant(T, (tx) => reconcileSessions(tx, { now: localToUtc(today, "00:00", "Asia/Kolkata"), batchIds: [batch] }));
  const [session] = await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batch), eq(sessions.sessionDate, addDays(today, 1)))));

  const add = (name: string, source: Source) => withTenant(T, (tx) => createEnquiry(tx, owner, { name, phone: `98722${String(10_000 + ++n)}`, programId: program, source }));
  const called = await add("Walk-in called", "walk_in");
  await withTenant(T, (tx) => logActivity(tx, owner, called.id, { kind: "call" }));
  const lostWalkIn = await add("Walk-in lost", "walk_in");
  await withTenant(T, (tx) => markLost(tx, owner, lostWalkIn.id, { reason: "timing" }));
  const trial = await add("Insta trial", "instagram");
  await withTenant(T, (tx) => bookTrial(tx, owner, trial.id, { sessionId: session?.id ?? "" }));
  const lostInsta = await add("Insta lost", "instagram");
  await withTenant(T, (tx) => markLost(tx, owner, lostInsta.id, { reason: "fees" }));
  const joined = await add("Referral joined", "referral");
  await withTenant(T, (tx) => convertEnquiry(tx, owner, joined.id, { adult: true, dateOfBirth: "1998-05-05", batchId: batch, consents: { dataProcessing: true } }));
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the enquiry report", () => {
  it("counts each stage reached, conversion by source and lost reasons for the dates", async () => {
    const r = await withTenant(T, (tx) => enquiryReport(tx, owner, { from: today, to: today }));
    expect(r.funnel).toEqual({ received: 5, contacted: 3, trialBooked: 1, trialDone: 0, won: 1, lost: 2 });
    const sources = Object.fromEntries(r.sources.map((s) => [s.source, [s.received, s.won]]));
    expect(sources).toEqual({ walk_in: [2, 0], instagram: [2, 0], referral: [1, 1] });
    expect(Object.fromEntries(r.lost.map((l) => [l.reason, l.count]))).toEqual({ timing: 1, fees: 1 });
  });

  it("dates outside the range count nothing; an upside-down range is refused", async () => {
    const r = await withTenant(T, (tx) => enquiryReport(tx, owner, { from: addDays(today, -7), to: addDays(today, -1) }));
    expect(r.funnel.received).toBe(0);
    await expect(withTenant(T, (tx) => enquiryReport(tx, owner, { from: today, to: addDays(today, -1) }))).rejects.toThrow("comes after");
  });
});
