import { tenancyFixtures } from "@/modules/tenancy/isolation";
import type { IsolationFixtures } from "./types";

// Every module with tenant-scoped tables contributes its fixtures here.
export const fixtures: IsolationFixtures = {
  ...tenancyFixtures,
};

// Tables in `app` that legitimately have no tenant_id column. Each needs a
// reason; anything else without tenant_id fails the suite.
export const PLATFORM_TABLES: Record<string, string> = {
  tenants: "the tenant itself; app_runtime is limited to its own row by policy tenant_self",
};
