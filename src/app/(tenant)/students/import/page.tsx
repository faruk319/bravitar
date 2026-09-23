import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "@/components/students/import-wizard";

export default function ImportStudentsPage() {
  return (
    <Gate permission="students:import">
      <PageHeader title="Import {student.many}" crumbs={[{ label: "{student.many}", href: "/students" }]} />
      <Card className="max-w-2xl">
        <ImportWizard />
      </Card>
    </Gate>
  );
}
