import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="reports:view">
      <PageTitle>{"Dashboard"}</PageTitle>
      <Placeholder title={"Nothing to show yet"} hint={"Today's attendance, collection and dues appear here once there are {student.many}."} action={"Add {student.one}"} />
    </Gate>
  );
}
