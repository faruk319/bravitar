import { BarList } from "@/components/reports/bars";
import { RangeForm } from "@/components/reports/range-form";
import { Card, CardHeader } from "@/components/ui/card";
import { LOST_REASON_LABELS, SOURCE_LABELS } from "@/modules/enquiries/lists";
import type { EnquiryReport as Report } from "@/modules/enquiries/service";

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const share = (n: number, of: number) => (
  <>
    {n} <span className="text-caption text-muted-foreground">· {pct(n, of)}%</span>
  </>
);

// docs/03 §4: the funnel, which sources convert, and why people are lost,
// for enquiries received between two dates; the CSV for those with reports:view.
export function EnquiryReport({ r, csv }: { r: Report; csv: boolean }) {
  const f = r.funnel;
  const stage = (key: string, label: string, n: number) => ({ key, label, value: share(n, f.received), fraction: f.received ? n / f.received : 0 });
  return (
    <div className="flex flex-col">
      <RangeForm from={r.from} to={r.to} keep={{ view: "report" }} {...(csv ? { csv: `/api/reports/enquiries?from=${r.from}&to=${r.to}` } : {})} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`${f.received} received`} />
          <BarList
            items={[
              stage("contacted", "Contacted", f.contacted),
              stage("trialBooked", "Trial booked", f.trialBooked),
              stage("trialDone", "Trial done", f.trialDone),
              stage("won", "Joined", f.won),
              stage("lost", "Lost", f.lost),
            ]}
          />
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
                    <td className="py-2 text-right tabular-nums">{share(s.won, s.received)}</td>
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
            <BarList items={r.lost.map((l) => ({ key: l.reason ?? "none", label: l.reason ? LOST_REASON_LABELS[l.reason] : "No reason", value: share(l.count, f.lost), fraction: f.lost ? l.count / f.lost : 0 }))} />
          ) : (
            <p className="text-body text-muted-foreground">Nobody lost in these dates.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
