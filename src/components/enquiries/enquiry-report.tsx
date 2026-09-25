import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LOST_REASON_LABELS, SOURCE_LABELS } from "@/modules/enquiries/lists";
import type { EnquiryReport as Report } from "@/modules/enquiries/service";

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function Bar({ label, n, of }: { label: string; n: number; of: number }) {
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3 text-body">
        <span>{label}</span>
        <span className="tabular-nums">
          {n} <span className="text-caption text-muted-foreground">· {pct(n, of)}%</span>
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-neutral-100">
        <div className="h-2 rounded-full bg-accent-600" style={{ width: `${pct(n, of)}%` }} />
      </div>
    </li>
  );
}

// docs/03 §4: the funnel, which sources convert, and why people are lost,
// for enquiries received between two dates.
export function EnquiryReport({ r }: { r: Report }) {
  const f = r.funnel;
  return (
    <div className="flex flex-col gap-5">
      <form className="flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="view" value="report" />
        <label className="flex flex-col gap-1 text-label">
          From
          <Input type="date" name="from" defaultValue={r.from} className="w-44" />
        </label>
        <label className="flex flex-col gap-1 text-label">
          To
          <Input type="date" name="to" defaultValue={r.to} className="w-44" />
        </label>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`${f.received} received`} />
          <ul className="divide-y divide-neutral-100">
            <Bar label="Contacted" n={f.contacted} of={f.received} />
            <Bar label="Trial booked" n={f.trialBooked} of={f.received} />
            <Bar label="Trial done" n={f.trialDone} of={f.received} />
            <Bar label="Joined" n={f.won} of={f.received} />
            <Bar label="Lost" n={f.lost} of={f.received} />
          </ul>
        </Card>
        <Card>
          <CardHeader title="By source" />
          {r.sources.length ? (
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-caption text-muted-foreground">
                  <th className="py-1.5 font-medium">Source</th>
                  <th className="py-1.5 text-right font-medium">Received</th>
                  <th className="py-1.5 text-right font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {r.sources.map((s) => (
                  <tr key={s.source ?? "none"} className="border-t border-neutral-100">
                    <td className="py-2">{s.source ? SOURCE_LABELS[s.source] : "Not set"}</td>
                    <td className="py-2 text-right tabular-nums">{s.received}</td>
                    <td className="py-2 text-right tabular-nums">
                      {s.won} <span className="text-caption text-muted-foreground">· {pct(s.won, s.received)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-body text-muted-foreground">No enquiries in these dates.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Why they were lost" />
          {r.lost.length ? (
            <ul className="divide-y divide-neutral-100">
              {r.lost.map((l) => (
                <Bar key={l.reason ?? "none"} label={l.reason ? LOST_REASON_LABELS[l.reason] : "No reason"} n={l.count} of={f.lost} />
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">Nobody lost in these dates.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
