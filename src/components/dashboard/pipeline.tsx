import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { formatCount } from "@/lib/money/format";
import { formatPhone } from "@/lib/phone";
import type { Dashboard } from "@/modules/dashboard/service";

// docs/07 §6: every number opens the list behind it.
function Figure({ label, value, note, href }: { label: string; value: ReactNode; note?: string; href: string }) {
  return (
    <Link href={href} className="flex min-h-20 flex-col gap-1 rounded-xl bg-neutral-50 p-3 hover:bg-neutral-100">
      <span className="text-label text-neutral-700">{label}</span>
      <span className="text-display text-neutral-900">{value}</span>
      {note ? <span className="text-caption text-muted-foreground">{note}</span> : null}
    </Link>
  );
}

export function Pipeline({ pipeline }: { pipeline: NonNullable<Dashboard["pipeline"]> }) {
  return (
    <Card>
      <CardHeader title="Pipeline" />
      <div className="grid grid-cols-2 gap-2">
        <Figure label="Follow-ups due" value={formatCount(pipeline.followUps)} href="/enquiries?view=follow_ups" />
        <Figure label="New enquiries" value={formatCount(pipeline.month.received)} note="this month" href="/enquiries?view=report" />
        <Figure label="Trial booked" value={formatCount(pipeline.month.trialBooked)} note="of these" href="/enquiries?view=report" />
        <Figure label="Joined" value={formatCount(pipeline.month.won)} note="of these" href="/enquiries?view=report" />
      </div>
      {pipeline.mine.length ? (
        <>
          <h3 className="mt-4 text-label text-muted-foreground">Your follow-ups</h3>
          <ul className="divide-y divide-neutral-100">
            {pipeline.mine.slice(0, 5).map((e) => (
              <li key={e.id}>
                <Link href={`/enquiries/${e.id}`} className="flex min-h-14 items-center justify-between gap-2 py-2 hover:bg-neutral-50">
                  <span>
                    <span className="block text-body font-medium text-neutral-900">{e.name}</span>
                    <span className="block text-caption text-muted-foreground">{e.programName ?? ""}</span>
                  </span>
                  <span className="text-label tabular-nums">{formatPhone(e.phone)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
