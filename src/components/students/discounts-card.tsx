import { EndDiscount, GiveDiscount } from "@/components/fees/discounts";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { GivenDiscount } from "@/modules/fees/repo";

type Choice = { id: string; name: string; kind: string; value: number };

const worth = (d: { kind: string; value: number }) => (d.kind === "percent" ? `${d.value}%` : formatPaise(BigInt(d.value)));

export function DiscountsCard({ discounts, choices, today, studentId, canDiscount }: { discounts: GivenDiscount[]; choices: Choice[]; today: string; studentId: string; canDiscount: boolean }) {
  return (
    <Card>
      <CardHeader title="Discounts" action={canDiscount && choices.length ? <GiveDiscount studentId={studentId} today={today} discounts={choices.map((d) => ({ id: d.id, label: `${d.name} · ${worth(d)}` }))} /> : null} />
      {discounts.length ? (
        <ul className="divide-y divide-neutral-100">
          {discounts.map((g) => {
            const running = !g.validTo || g.validTo >= today;
            return (
              <li key={g.id} className={cn("flex min-h-14 items-center justify-between gap-3 py-2", !running && "text-neutral-500")}>
                <div>
                  <p className="text-body">
                    {g.name} <span className="text-caption text-muted-foreground">· {worth(g)}</span>
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {g.reason} · {g.validTo ? `${formatDate(g.validFrom)} – ${formatDate(g.validTo)}` : `from ${formatDate(g.validFrom)}`}
                    {g.approvedByName ? ` · by ${g.approvedByName}` : ""}
                  </p>
                </div>
                {canDiscount && running ? <EndDiscount id={g.id} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">No discounts.</p>
      )}
    </Card>
  );
}
