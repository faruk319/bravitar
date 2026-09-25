import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The report's dates (GET, so the address can be shared) and its CSV.
export function RangeForm({ from, to, csv, keep = {} }: { from?: string; to?: string; csv?: string; keep?: Record<string, string> }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-2">
      {from && to ? (
        <form className="flex flex-wrap items-end gap-2" method="get">
          {Object.entries(keep).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <label className="flex flex-col gap-1 text-label">
            From
            <Input type="date" name="from" defaultValue={from} className="w-44" />
          </label>
          <label className="flex flex-col gap-1 text-label">
            To
            <Input type="date" name="to" defaultValue={to} className="w-44" />
          </label>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
      ) : null}
      {csv ? (
        <Button variant="outline" nativeButton={false} render={<a href={csv} download />}>
          <Download data-icon="inline-start" /> Download CSV
        </Button>
      ) : null}
    </div>
  );
}

// Report dates from the address: valid ISO dates, the earlier one first.
export function pickRange(sp: Record<string, string | string[] | undefined>, fallback: { from: string; to: string }): { from: string; to: string } {
  const date = (v: string | string[] | undefined, d: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
  const [from = fallback.from, to = fallback.to] = [date(sp.from, fallback.from), date(sp.to, fallback.to)].sort();
  return { from, to };
}
