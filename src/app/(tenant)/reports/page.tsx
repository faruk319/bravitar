import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";

const REPORTS = [
  { href: "/reports/collection", title: "Collection register", hint: "Receipts by day, method and staff" },
  { href: "/reports/dues", title: "Outstanding dues", hint: "What each family owes, by how late" },
  { href: "/reports/attendance", title: "Attendance summary", hint: "By batch and by student" },
  { href: "/reports/at-risk", title: "At risk", hint: "Missing classes or behind on fees" },
  { href: "/reports/admissions", title: "Admissions and dropouts", hint: "Who joined and who left" },
  { href: "/enquiries?view=report", title: "Enquiry funnel", hint: "Enquiries by stage and source" },
];

// docs/03 §11: every report has dates and a CSV.
export default function ReportsPage() {
  return (
    <Gate permission="reports:view">
      <PageHeader title="Reports" />
      <div className="grid gap-3 md:grid-cols-2">
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
