import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="reports:view">
      <PageTitle>{"Reports"}</PageTitle>
      <Placeholder title={"No reports yet"} hint={"Attendance, collection and dues reports, all exportable."} action={"Export CSV"} />
    </Gate>
  );
}
