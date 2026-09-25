import { AddEnquiry } from "@/components/enquiries/add-enquiry";
import { EnquiryReport } from "@/components/enquiries/enquiry-report";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Row } from "@/components/row";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { addDays, formatDate, isIsoDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { cn } from "@/lib/utils";
import { coachOptions, listPrograms } from "@/modules/batches/repo";
import { listBatchViews } from "@/modules/batches/service";
import { LOST_REASON_LABELS, SOURCE_LABELS, STATUS_LABELS } from "@/modules/enquiries/lists";
import type { EnquiryRow } from "@/modules/enquiries/repo";
import { BOARD_VIEWS, type BoardView, enquiryBoard, enquiryReport } from "@/modules/enquiries/service";

const EMPTY: Record<BoardView, string> = {
  follow_ups: "No follow-ups due",
  new: "No new enquiries",
  contacted: "Nobody waiting after a call",
  trial_booked: "No trials booked",
  trial_done: "No trials to follow up",
  won: "Nobody has joined from an enquiry yet",
  lost: "No lost enquiries",
};

function Trailing({ e, today }: { e: EnquiryRow; today: string }) {
  if (e.status === "lost") return <span className="text-caption text-muted-foreground">{e.lostReason ? LOST_REASON_LABELS[e.lostReason] : ""}</span>;
  if (e.status === "won" || !e.nextFollowUp) return null;
  const late = e.nextFollowUp < today;
  return <span className={cn("text-caption", late ? "text-danger-600" : e.nextFollowUp === today ? "text-warning-600" : "text-muted-foreground")}>{e.nextFollowUp === today ? "Today" : formatDate(e.nextFollowUp)}</span>;
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

// docs/03 §4: the board by status, today's follow-ups first, and the report.
export default async function EnquiriesPage({ searchParams }: PageProps<"/enquiries">) {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "enquiries:read")) return <Gate permission="enquiries:read">{null}</Gate>;
  const sp = await searchParams;
  const report = sp.view === "report";
  const view = BOARD_VIEWS.find((v) => v === sp.view) ?? "follow_ups";
  const canAdd = allows(ctx, "enquiries:create");
  const data = await withTenant(session.tenant.id, async (tx) => ({
    board: await enquiryBoard(tx, ctx, view),
    ...(canAdd
      ? {
          programs: (await listPrograms(tx, { activeOnly: true })).map((p) => ({ id: p.id, name: p.name })),
          batches: (await listBatchViews(tx, ctx.branchIds)).map((b) => ({ id: b.id, name: b.name, programId: b.programId })),
          staff: (await coachOptions(tx)).map((s) => ({ id: s.id, name: s.fullName })),
        }
      : {}),
  }));
  const { counts, rows, today } = data.board;
  const tabs = [
    ...BOARD_VIEWS.map((v) => ({ href: `/enquiries?view=${v}`, label: `${v === "follow_ups" ? "Follow-ups" : STATUS_LABELS[v]}${counts[v] ? ` · ${counts[v]}` : ""}`, active: !report && v === view })),
    { href: "/enquiries?view=report", label: "Report", active: report },
  ];
  const date = (v: string | undefined, fallback: string) => (v && isIsoDate(v) ? v : fallback);
  const [from = today, to = today] = [date(one(sp.from), `${today.slice(0, 7)}-01`), date(one(sp.to), today)].sort();
  const shown = report ? await withTenant(session.tenant.id, (tx) => enquiryReport(tx, ctx, { from, to })) : undefined;

  return (
    <Gate permission="enquiries:read">
      <PageHeader
        title="Enquiries"
        actions={data.programs ? <AddEnquiry programs={data.programs} batches={data.batches ?? []} staff={data.staff ?? []} me={ctx.staffId} tomorrow={addDays(today, 1)} /> : null}
      />
      <SegmentedTabs label="Enquiries" items={tabs} />
      {shown ? (
        <EnquiryReport r={shown} csv={allows(ctx, "reports:view")} />
      ) : (
        <Card className="overflow-hidden p-0 md:p-0">
          {rows.length ? (
            rows.map((e) => (
              <Row key={e.id} href={`/enquiries/${e.id}`} trailing={<Trailing e={e} today={today} />}>
                <span className="block truncate font-medium text-neutral-900">{e.name}</span>
                <span className="block truncate text-caption text-muted-foreground">
                  {[e.programName, e.source ? SOURCE_LABELS[e.source] : null, view === "follow_ups" && e.ownerStaffId !== ctx.staffId ? e.ownerName : null].filter(Boolean).join(" · ")}
                </span>
              </Row>
            ))
          ) : (
            <EmptyState title={EMPTY[view]} hint="Every call or walk-in goes here until they join." />
          )}
        </Card>
      )}
    </Gate>
  );
}
