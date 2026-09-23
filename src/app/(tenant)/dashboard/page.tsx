import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="reports:view">
      <PageHeader title="Dashboard" />
      <Placeholder title={"Nothing to show yet"} hint={"Today's attendance, collection and dues appear here once there are {student.many}."} action={"Add {student.one}"} />
    </Gate>
  );
}
