import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PagingFooter } from "@/components/paging-footer";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/url-query";
import type { StudentPlanTab } from "@/modules/fees/repo";
import { parseStudentPlanQuery, type StudentPlanRow, studentPlanList, studentPlanParams } from "@/modules/fees/service";

const PATH = "/finance/student-plans";
const TABS: [StudentPlanTab, string][] = [["active", "Active"], ["paused", "Paused"], ["ended", "Ended"]];
const EMPTY: Record<StudentPlanTab, [string, string]> = {
  active: ["No active plans", "Plans appear when a student joins a batch with a fee plan."],
  paused: ["No paused plans", "Paused students show here."],
  ended: ["No ended plans", "Plans of students who left show here."],
};
const PER: Record<string, string> = { monthly: "month", quarterly: "quarter", half_yearly: "6 months", yearly: "year" };

const dash = <span className="text-muted-foreground">—</span>;
const fee = (r: StudentPlanRow) => (
  <>
    <Money paise={r.amountPaise} />
    {r.kind === "recurring" ? ` / ${PER[r.cycle] ?? r.cycle}` : ""}
  </>
);
const owing = (r: StudentPlanRow) => (r.outstandingPaise > 0n ? <Money paise={r.outstandingPaise} className="font-medium" /> : dash);
const when = (r: StudentPlanRow) => (r.endDate ? `${formatDate(r.startDate)} – ${formatDate(r.endDate)}` : formatDate(r.startDate));

export default async function StudentPlansPage({ searchParams }: PageProps<"/finance/student-plans">) {
  const query = parseStudentPlanQuery(await searchParams);
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const list = await withTenant(session.tenant.id, (tx) => studentPlanList(tx, ctx, query));
  const { applied, counts } = list;
  const href = (params: URLSearchParams) => withQuery(PATH, params);
  const filtered = Boolean(applied.q || applied.programId || applied.batchId || applied.planId);
  const [emptyTitle, emptyHint] = filtered ? ["No plan matches", "Change the filters or clear them."] : EMPTY[applied.tab];
  const head = "py-2.5 pr-4 font-medium";

  return (
    <Gate permission="invoices:read">
      <PageHeader title="Student plans" />
      <SegmentedTabs label="Student plans" items={TABS.map(([tab, word]) => ({ href: href(studentPlanParams({ ...applied, tab })), label: `${word} · ${counts[tab]}`, active: tab === applied.tab }))} />
      <Card className="overflow-hidden p-0 md:p-0">
        <div className="p-4 md:p-5">
          <Suspense>
            <FilterBar
              path={PATH}
              search={{ placeholder: "Student or code" }}
              selects={[
                { name: "program", label: "Program", all: "All programs", options: list.options.programs },
                { name: "batch", label: "Batch", all: "All batches", options: list.options.batches },
                { name: "plan", label: "Plan", all: "All plans", options: list.options.plans },
              ]}
              dates={[]}
            />
          </Suspense>
        </div>
        {list.rows.length === 0 ? (
          <EmptyState title={emptyTitle} hint={emptyHint} />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead>
                  <tr className="bg-neutral-50 text-left text-caption text-muted-foreground">
                    <th className="px-5 py-2.5 pr-4 font-medium">Student</th>
                    <th className={head}>Program</th>
                    <th className={head}>Plan</th>
                    <th className={head}>Payer</th>
                    <th className={head}>{applied.tab === "ended" ? "Dates" : "Started"}</th>
                    {applied.tab === "active" ? <th className={head}>Next bill</th> : null}
                    <th className={cn(head, "px-5 pr-5 text-right")}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.enrollmentId} className="relative border-t border-neutral-100 align-top hover:bg-neutral-50">
                      <td className="px-5 py-2.5 pr-4">
                        <Link href={`/students/${r.studentId}`} className="block text-body font-medium text-neutral-900 after:absolute after:inset-0">
                          {r.studentName}
                        </Link>
                        <span className="block text-caption text-muted-foreground">{r.studentCode}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="block text-body">{r.programName}</span>
                        <span className="block text-caption text-muted-foreground">{r.batchName}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Link href={`${PATH}/${r.enrollmentId}`} className="relative z-10 block text-body text-accent-600 hover:underline">
                          {r.planName}
                        </Link>
                        <span className="block text-caption text-muted-foreground">{fee(r)}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-body">{r.payerName || dash}</td>
                      <td className="py-2.5 pr-4 text-body whitespace-nowrap">{when(r)}</td>
                      {applied.tab === "active" ? <td className="py-2.5 pr-4 text-body whitespace-nowrap">{r.packText ?? (r.nextBill ? formatDate(r.nextBill) : dash)}</td> : null}
                      <td className="px-5 py-2.5 text-right text-body whitespace-nowrap">{owing(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden">
              {list.rows.map((r) => (
                <li key={r.enrollmentId} className="relative flex flex-col gap-1.5 border-t border-neutral-100 px-4 py-3 first:border-t-0 active:bg-neutral-50">
                  <Link href={`/students/${r.studentId}`} className="truncate text-body font-medium after:absolute after:inset-0">
                    {r.studentName}
                  </Link>
                  <p className="truncate text-caption text-muted-foreground">
                    {r.programName} · {r.batchName}
                  </p>
                  <p className="truncate text-caption text-muted-foreground">
                    <Link href={`${PATH}/${r.enrollmentId}`} className="relative z-10 text-accent-600 hover:underline">
                      {r.planName}
                    </Link>{" "}
                    · {fee(r)}
                  </p>
                  <p className="truncate text-caption text-muted-foreground">{[r.payerName && `Payer ${r.payerName}`, when(r)].filter(Boolean).join(" · ")}</p>
                  <dl className="mt-1 grid grid-cols-2 gap-2 text-caption">
                    {applied.tab === "active" ? (
                      <div>
                        <dt className="text-muted-foreground">Next bill</dt>
                        <dd className="text-body">{r.packText ?? (r.nextBill ? formatDate(r.nextBill) : dash)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-muted-foreground">Outstanding</dt>
                      <dd className="text-body tabular-nums">{owing(r)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <PagingFooter page={list.page} pageSize={list.pageSize} shown={list.rows.length} matched={list.matched} href={(p) => href(studentPlanParams(applied, p))} />
          </>
        )}
      </Card>
    </Gate>
  );
}
