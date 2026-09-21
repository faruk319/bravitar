import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="students:read">
      <PageTitle>{"{student.many}"}</PageTitle>
      <Placeholder title={"No {student.many} yet"} hint={"Add the first one, or import your register."} action={"Add {student.one}"} />
    </Gate>
  );
}
