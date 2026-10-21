import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";

const REPORTS = [
  { href: "/finance/reports/collection", title: "Collection register", hint: "Receipts and refunds by day, method and staff" },
  { href: "/finance/reports/dues", title: "Outstanding dues", hint: "What each payer owes, by how late" },
  { href: "/finance/reports/revenue", title: "Revenue", hint: "Billed, collected and outstanding by program" },
  { href: "/finance/discounts?tab=given", title: "Discounts given", hint: "Every discount on an issued invoice" },
  { href: "/finance/discounts?tab=advance", title: "Advance held", hint: "Who has paid ahead" },
];

export default function FinanceReportsPage() {
  return (
    <Gate permission="reports:view">
      <PageHeader title="Reports" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href}>
            <Card className="h-full hover:bg-neutral-50">
              <span className="block text-body font-medium text-neutral-900">{r.title}</span>
              <span className="block text-caption text-muted-foreground">{r.hint}</span>
            </Card>
          </Link>
        ))}
      </div>
    </Gate>
  );
}
