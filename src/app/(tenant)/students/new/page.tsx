import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { AddStudentForm } from "@/components/students/add-student-form";

export default function NewStudentPage() {
  return (
    <Gate permission="students:create">
      <PageHeader title="Add {student.one}" crumbs={[{ label: "{student.many}", href: "/students" }]} />
      <Card className="max-w-2xl">
        <AddStudentForm />
      </Card>
    </Gate>
  );
}
