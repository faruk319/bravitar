import { Gate } from "@/components/shell/gate";
import { PageTitle } from "@/components/shell/placeholder";
import { AddStudentForm } from "@/components/students/add-student-form";

export default function NewStudentPage() {
  return (
    <Gate permission="students:create">
      <PageTitle>{"Add {student.one}"}</PageTitle>
      <AddStudentForm />
    </Gate>
  );
}
