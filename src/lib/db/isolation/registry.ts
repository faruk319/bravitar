import { attendanceFixtures } from "@/modules/attendance/isolation";
import { authFixtures } from "@/modules/auth/isolation";
import { batchFixtures } from "@/modules/batches/isolation";
import { enrollmentFixtures } from "@/modules/enrollments/isolation";
import { enquiryFixtures } from "@/modules/enquiries/isolation";
import { feeFixtures } from "@/modules/fees/isolation";
import { integrationFixtures } from "@/modules/integrations/isolation";
import { messagingFixtures } from "@/modules/messaging/isolation";
import { numberingFixtures } from "@/modules/numbering/isolation";
import { paymentFixtures } from "@/modules/payments/isolation";
import { platformFixtures } from "@/modules/platform/isolation";
import { sessionFixtures } from "@/modules/sessions/isolation";
import { staffFixtures } from "@/modules/staff/isolation";
import { studentFixtures } from "@/modules/students/isolation";
import { tenancyFixtures } from "@/modules/tenancy/isolation";
import { systemFixtures } from "./system";
import type { IsolationFixtures } from "./types";

// Every module with tenant-scoped tables contributes its fixtures here.
export const fixtures: IsolationFixtures = {
  ...tenancyFixtures,
  ...platformFixtures,
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
  platform_plans: "global reference data; app_runtime has SELECT only, the platform role edits it",
  permissions: "global catalog synced from src/lib/auth/permissions.ts; app_runtime has SELECT only",
  otp_codes: "a phone's login codes, not an academy's; app_runtime has no access, only otp_issue and otp_check (migration 0020)",
};
