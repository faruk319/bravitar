import { MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConvertEnquiry } from "@/components/enquiries/convert-enquiry";
import { BookTrial, CancelTrial, EditEnquiry, LogActivity, MarkLost, Reopen } from "@/components/enquiries/enquiry-actions";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { addDays, formatDate, timeIn, weekdayOf } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { coachOptions, listPrograms } from "@/modules/batches/repo";
import { WEEKDAY_SHORT } from "@/modules/batches/schedule";
import { listBatchViews } from "@/modules/batches/service";
import { ACTIVITY_LABELS, LOST_REASON_LABELS, OPEN_STATUSES, SOURCE_LABELS, STATUS_LABELS } from "@/modules/enquiries/lists";
import { suggestedBatch } from "@/modules/enquiries/convert";
import { trialsOf, type TrialRow } from "@/modules/enquiries/repo";
import { enquiryDetail } from "@/modules/enquiries/service";
import { trialChoices } from "@/modules/enquiries/trials";

const STATUS_CLASS: Record<string, string> = { won: "bg-success-600/10 text-success-600", lost: "bg-neutral-100 text-neutral-500" };
const MARK_WORDS = { present: "Came", late: "Came late", absent: "Missed", excused: "Excused" } as const;

// What happened to a trial, in a word.
function trialState(t: TrialRow, today: string): [string, string] {
  if (t.cancelledAt) return ["Cancelled", "text-muted-foreground"];
  if (t.sessionStatus === "cancelled") return ["Class cancelled", "text-warning-600"];
  if (t.mark) return [MARK_WORDS[t.mark], t.mark === "absent" ? "text-danger-600" : "text-success-600"];
  return t.trialDate < today ? ["Not marked", "text-warning-600"] : ["Booked", "text-accent-600"];
}

// docs/03 §4: the enquiry, how to reach them, and everything that happened.
export default async function EnquiryPage({ params }: PageProps<"/enquiries/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "enquiries:read")) return <Gate permission="enquiries:read">{null}</Gate>;
  const canUpdate = allows(ctx, "enquiries:update");
  const canConvert = allows(ctx, "enquiries:convert") && allows(ctx, "students:create") && allows(ctx, "enrollments:manage");
  const tz = session.tenant.timezone;
  const data = await withTenant(session.tenant.id, async (tx) => {
    const detail = await enquiryDetail(tx, ctx, id);
    const open = OPEN_STATUSES.includes(detail.enquiry.status);
    const batchViews = canUpdate || canConvert ? await listBatchViews(tx, ctx.branchIds) : [];
    return {
      ...detail,
      trials: await trialsOf(tx, id),
      convert: canConvert && open ? { batches: batchViews.map((b) => ({ id: b.id, label: `${b.name} · ${b.schedule}` })), batchId: await suggestedBatch(tx, id, detail.enquiry.batchId) } : undefined,
      ...(canUpdate
        ? {
            programs: (await listPrograms(tx, { activeOnly: true })).map((p) => ({ id: p.id, name: p.name })),
            batches: batchViews.map((b) => ({ id: b.id, name: b.name, programId: b.programId })),
            staff: (await coachOptions(tx)).map((s) => ({ id: s.id, name: s.fullName })),
            choices: open
              ? (await trialChoices(tx, ctx, detail.enquiry)).map((b) => ({
                  id: b.id,
                  name: b.name,
                  classes: b.classes.map((c) => ({ sessionId: c.sessionId, label: `${WEEKDAY_SHORT[weekdayOf(c.date)]}, ${formatDate(c.date)} · ${timeIn(tz, c.startsAt)}–${timeIn(tz, c.endsAt)}` })),
                }))
              : [],
          }
        : {}),
    };
  }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { enquiry: e, activities, matches, today, trials } = data;
  const isOpen = OPEN_STATUSES.includes(e.status);
  const facts: [string, string][] = [
    ["Parent", e.contactName ?? "—"],
    ["Program", [e.programName, e.batchName].filter(Boolean).join(" · ") || "—"],
    ["Source", e.source ? SOURCE_LABELS[e.source] : "—"],
    ["Assigned to", e.ownerName ?? "—"],
    ...(isOpen ? ([["Follow up", e.nextFollowUp ? (e.nextFollowUp === today ? "Today" : formatDate(e.nextFollowUp)) : "—"]] as [string, string][]) : []),
    ...(e.status === "lost" ? ([["Lost", [e.lostReason ? LOST_REASON_LABELS[e.lostReason] : "", e.lostNote].filter(Boolean).join(" · ")]] as [string, string][]) : []),
    ...(e.notes ? ([["Note", e.notes]] as [string, string][]) : []),
  ];

  return (
    <Gate permission="enquiries:read">
      <PageHeader title={e.name} crumbs={[{ href: "/enquiries", label: "Enquiries" }]}>
        <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-label", STATUS_CLASS[e.status] ?? "bg-accent-50 text-accent-600")}>{STATUS_LABELS[e.status]}</span>
        {e.convertedStudentId ? (
          <Link href={`/students/${e.convertedStudentId}`} className="ml-2 text-label text-accent-600 hover:underline">
            View student →
          </Link>
        ) : null}
      </PageHeader>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-body font-medium tabular-nums">{formatPhone(e.phone)}</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`tel:${e.phone}`} />}>
                <Phone data-icon="inline-start" /> Call
              </Button>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`https://wa.me/${e.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" />}>
                <MessageCircle data-icon="inline-start" /> WhatsApp
              </Button>
            </span>
          </div>
          {isOpen && (matches.enquiries.length || matches.family) ? (
            <p className="mt-3 rounded-lg bg-warning-600/10 px-3 py-2 text-label">
              {matches.enquiries.map((m) => (
                <a key={m.id} href={`/enquiries/${m.id}`} className="block underline">
                  Also an enquiry: {m.name}
                </a>
              ))}
              {matches.family ? <span className="block">This number belongs to {matches.family.guardianName} ({matches.family.students.join(", ") || matches.family.householdName})</span> : null}
            </p>
          ) : null}
          <dl className="mt-3 divide-y divide-neutral-100">
            {facts.map(([k, v]) => (
              <div key={k} className="flex min-h-12 items-center justify-between gap-4">
                <dt className="text-label text-muted-foreground">{k}</dt>
                <dd className="text-right text-body">{v}</dd>
              </div>
            ))}
          </dl>
          {canUpdate && data.programs ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {data.convert ? <ConvertEnquiry id={e.id} name={e.name} phone={e.phone} contactName={e.contactName} batches={data.convert.batches} batchId={data.convert.batchId} today={today} /> : null}
              {isOpen ? <LogActivity id={e.id} nextFollowUp={e.nextFollowUp && e.nextFollowUp > today ? e.nextFollowUp : addDays(today, 2)} /> : null}
              <EditEnquiry e={e} programs={data.programs} batches={data.batches ?? []} staff={data.staff ?? []} />
              {isOpen ? <MarkLost id={e.id} /> : null}
              {e.status === "lost" ? <Reopen id={e.id} /> : null}
            </div>
          ) : null}
        </Card>
        {trials.length || data.choices?.length ? (
          <Card>
            <CardHeader title="Trials" action={isOpen && data.choices?.length ? <BookTrial id={e.id} batches={data.choices} /> : null} />
            {trials.length ? (
              <ul className="divide-y divide-neutral-100">
                {trials.map((t) => {
                  const [word, cls] = trialState(t, today);
                  return (
                    <li key={t.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                      <span>
                        <span className="block text-body">{t.batchName}</span>
                        <span className="block text-caption text-muted-foreground">
                          {formatDate(t.trialDate)}, {timeIn(tz, t.startsAt)}
                          {t.feedback ? ` · ${t.feedback}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={cn("text-label", cls)}>{word}</span>
                        {canUpdate && isOpen && !t.mark && !t.cancelledAt && t.sessionStatus !== "cancelled" ? <CancelTrial trialId={t.id} /> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No trial yet.</p>
            )}
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Timeline" />
          <ol className="divide-y divide-neutral-100">
            {activities.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2.5">
                <span className="text-body">
                  <span className="font-medium">{a.kind === "status_change" && a.toStatus ? STATUS_LABELS[a.toStatus] : ACTIVITY_LABELS[a.kind]}</span>
                  {a.note ? ` · ${a.note}` : ""}
                </span>
                <span className="text-caption text-muted-foreground">
                  {formatDate(a.happenedAt)}, {timeIn(tz, a.happenedAt)}
                  {a.staffName ? ` · ${a.staffName}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </Gate>
  );
}
