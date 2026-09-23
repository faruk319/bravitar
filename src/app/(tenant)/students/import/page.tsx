import { Gate } from "@/components/shell/gate";
import { PageTitle } from "@/components/shell/placeholder";
import { ImportWizard } from "@/components/students/import-wizard";

export default function ImportStudentsPage() {
  return (
    <Gate permission="students:import">
      <PageTitle>{"Import {student.many}"}</PageTitle>
      <ImportWizard />
    </Gate>
  );
}
