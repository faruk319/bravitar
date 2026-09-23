import { BatchTabs } from "@/components/batches/batch-tabs";
import { HolidayList } from "@/components/batches/holiday-list";
import { Gate } from "@/components/shell/gate";
import { PageTitle } from "@/components/shell/placeholder";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { todayIn } from "@/lib/dates";
import { holidayList } from "@/modules/batches/service";
import { getOwnTenant } from "@/modules/tenancy/repo";

export default async function HolidaysPage() {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const data = can(ctx, "batches", "batches:read")
    ? await withTenant(session.tenant.id, async (tx) => {
        const today = todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata");
        return { today, holidays: await holidayList(tx, ctx, { from: today }) };
      })
    : { today: "", holidays: [] };
  return (
    <Gate permission="batches:read">
      <PageTitle>{"Programs & {batch.many}"}</PageTitle>
      <BatchTabs />
      <HolidayList
        holidays={data.holidays.map((h) => ({ id: h.id, date: h.date, name: h.name, branchId: h.branchId }))}
        canManage={can(ctx, "batches", "batches:manage")}
        allBranches={!session.branchIds.length}
        today={data.today}
      />
    </Gate>
  );
}
