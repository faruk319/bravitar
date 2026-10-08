import Link from "next/link";
import type { ReactNode } from "react";
import { Composer } from "@/components/messaging/composer";
import { Money } from "@/components/money";
import { AddFamilyMember, FamilyMemberActions } from "@/components/students/family";
import { PhotoConsentToggle, StatusActions } from "@/components/students/student-actions";
import { StatusBadge } from "@/components/students/status-badge";
import { WhatsappOptin } from "@/components/students/whatsapp-optin";
import type { DueItem } from "@/components/fees/still-due";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { sum } from "@/lib/money/paise";
import { formatPhone } from "@/lib/phone";
import { emailRows } from "@/lib/students/profile";
import type { FamilyAccount } from "@/modules/payments/service";
import type { StudentProfile } from "@/modules/students/profile";
import { RELATION_LABELS } from "@/modules/students/relations";

const dash = "—";

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-neutral-100">
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} className="flex min-h-12 items-center justify-between gap-3">
          <dt className="shrink-0 text-label text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words text-right text-body">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PersonalCard({ o, canUpdate }: { o: StudentProfile; canUpdate: boolean }) {
  const s = o.student;
  const emails = emailRows(o.guardians);
  return (
    <Card>
      <CardHeader title="Personal" />
      <Rows
        rows={[
          ["Full name", s.fullName],
          ["Born", s.dateOfBirth ? formatDate(s.dateOfBirth) : dash],
          ["Gender", s.gender ? (s.gender[0]?.toUpperCase() ?? "") + s.gender.slice(1) : dash],
          ["Phone", s.phone ? formatPhone(s.phone) : dash],
          ...(emails.length ? emails.map((e): [string, ReactNode] => [e.label, e.value]) : [["Email", dash] as [string, ReactNode]]),
          ["Address", s.address ?? dash],
        ]}
      />
      <div className="mt-3 border-t border-neutral-100 pt-3">
        <p className="text-caption text-muted-foreground">Data processing consent {o.consents.data_processing ? "given" : "missing"}</p>
        <PhotoConsentToggle studentId={s.id} granted={Boolean(o.consents.photo)} canUpdate={canUpdate} />
      </div>
    </Card>
  );
}

export function GuardianCard({ o, account, canUpdate, canMessage }: { o: StudentProfile; account?: FamilyAccount | undefined; canUpdate: boolean; canMessage: boolean }) {
  const s = o.student;
  return (
    <Card>
      <CardHeader title="Parent / Guardian" action={canMessage && o.guardians.length ? <Composer request={{ key: "welcome", studentId: s.id }} label="Welcome message" size="sm" /> : null} />
      {account && (account.open.length || account.advancePaise > 0n) ? (
        <dl className="mb-2 divide-y divide-neutral-100 border-y border-neutral-100">
          {account.open.length ? (
            <div className="flex min-h-12 items-center justify-between gap-3">
              <dt className="text-label text-muted-foreground">Due</dt>
              <dd>
                <Money paise={sum(account.open.map((i) => i.balancePaise))} className="text-body font-medium" />
              </dd>
            </div>
          ) : null}
          {account.advancePaise > 0n ? (
            <div className="flex min-h-12 items-center justify-between gap-3">
              <dt className="text-label text-muted-foreground">Advance</dt>
              <dd>
                <Money paise={account.advancePaise} className="text-body font-medium" />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {o.guardians.length ? (
        <ul className="divide-y divide-neutral-100">
          {o.guardians.map((g) => (
            <li key={g.id} className="flex min-h-14 items-center justify-between gap-3 py-1">
              <span className="min-w-0">
                <span className="block text-body">
                  {g.fullName} <span className="text-caption text-muted-foreground">· {RELATION_LABELS[g.relation]}</span>
                  {g.isManager ? <span className="ml-1.5 rounded-full bg-accent-50 px-2 py-0.5 text-caption text-accent-600">Manager</span> : null}
                </span>
                {g.address ? <span className="block text-caption text-muted-foreground">{g.address}</span> : null}
                <WhatsappOptin guardianId={g.id} on={g.whatsappOptin} canUpdate={canUpdate} />
                {canUpdate && !g.isManager ? <FamilyMemberActions studentId={s.id} guardianId={g.id} removable={!g.isPrimary} /> : null}
              </span>
              <a href={`tel:${g.phone}`} className="inline-flex min-h-11 items-center text-body text-accent-600 tabular-nums">
                {formatPhone(g.phone)}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">No guardian.</p>
      )}
      {canUpdate ? <AddFamilyMember studentId={s.id} /> : null}
      {o.siblings.length ? (
        <p className="mt-2 text-body">
          Siblings:{" "}
          {o.siblings.map((sib, i) => (
            <span key={sib.id}>
              {i ? ", " : ""}
              <Link href={`/students/${sib.id}`} className="text-accent-600 hover:underline">
                {sib.fullName}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </Card>
  );
}

export function EnrollmentCard({ o, today, canUpdate, due }: { o: StudentProfile; today: string; canUpdate: boolean; due: DueItem[] }) {
  const s = o.student;
  const current = o.batches?.current ?? [];
  const rows: [string, ReactNode][] = [];
  if (o.batches) {
    if (!current.length) rows.push(["Batch", "Not in a batch yet"]);
    for (const e of current) {
      rows.push(["Program", e.programName], ["Batch", e.batchName], ["Coach", e.coachName ?? dash]);
      // The fee plan is fee information: it follows the viewer's invoices:read.
      if (o.nextDue !== undefined) rows.push(["Fee plan", e.planName ?? dash]);
    }
  }
  rows.push(["Joined", formatDate(s.joinedOn)], ["Status", <StatusBadge key="st" status={s.status} />]);
  if (o.nextDue !== undefined) rows.push(["Next due", o.nextDue ? <span key="nd">{formatDate(o.nextDue)}{o.nextDue < today ? " · overdue" : ""}</span> : dash]);
  return (
    <Card>
      <CardHeader title="Enrollment" />
      <Rows rows={rows} />
      {s.status === "left" ? <p className="mt-2 text-caption text-muted-foreground">Left {formatDate(s.leftOn)}{s.leftReason ? ` (${s.leftReason.replace("_", " ")})` : ""}</p> : null}
      <div className="mt-3 [&>div]:justify-start">
        <StatusActions student={s} canUpdate={canUpdate} due={due} />
      </div>
    </Card>
  );
}
