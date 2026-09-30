import { attendanceFixtures } from "@/modules/attendance/isolation";
import { authFixtures } from "@/modules/auth/isolation";
import { batchFixtures } from "@/modules/batches/isolation";
import { billingFixtures } from "@/modules/billing/isolation";
import { enrollmentFixtures } from "@/modules/enrollments/isolation";
import { enquiryFixtures } from "@/modules/enquiries/isolation";
import { feeFixtures } from "@/modules/fees/isolation";
import { integrationFixtures } from "@/modules/integrations/isolation";
import { messagingFixtures } from "@/modules/messaging/isolation";
import { numberingFixtures } from "@/modules/numbering/isolation";
import { paymentFixtures } from "@/modules/payments/isolation";
import { sessionFixtures } from "@/modules/sessions/isolation";
import { staffFixtures } from "@/modules/staff/isolation";
import { studentFixtures } from "@/modules/students/isolation";
import { tenancyFixtures } from "@/modules/tenancy/isolation";
import { systemFixtures } from "./system";
import type { IsolationFixtures } from "./types";

// Every module with tenant-scoped tables contributes its fixtures here.
export const fixtures: IsolationFixtures = {
  ...tenancyFixtures,
  ...billingFixtures,
  ...staffFixtures,
  ...authFixtures,
  ...studentFixtures,
  ...batchFixtures,
  ...sessionFixtures,
  ...enrollmentFixtures,
  ...attendanceFixtures,
  ...enquiryFixtures,
  ...numberingFixtures,
  ...messagingFixtures,
  ...feeFixtures,
  ...paymentFixtures,
  ...integrationFixtures,
  ...systemFixtures,
};

// Tables in `app` that legitimately have no tenant_id column. Each needs a
// reason; anything else without tenant_id fails the suite.
export const PLATFORM_TABLES: Record<string, string> = {
  tenants: "the tenant itself; app_runtime is limited to its own row by policy tenant_self",
  activities: "Bravitar's activity catalog and prices; app_runtime has SELECT only, the platform role edits it (migration 0026)",
  activity_price_history: "past catalog prices; app_runtime has no access (migration 0026)",
  billing_settings: "one row of Bravitar's billing settings; app_runtime has SELECT only (migration 0026)",
  permissions: "global catalog synced from src/lib/auth/permissions.ts; app_runtime has SELECT only",
  otp_codes: "a phone's login codes, not an academy's; app_runtime has no access, only otp_issue and otp_check (migration 0020)",
  platform_admins: "Bravitar's own admins; app_runtime has no access, only the platform role (migration 0024)",
  platform_login_attempts: "sign-in tries on /platform; app_runtime has no access (migration 0024)",
};

// Tenant-scoped tables only the platform role writes: the suite seeds them
// through it and checks app_runtime can't write them, even its own rows.
export const PLATFORM_WRITTEN: Record<string, string> = {
  activity_subscriptions: "what an academy pays Bravitar; activated, paused and priced by the platform (migration 0026)",
};
