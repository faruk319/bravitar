import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="reports:view">
      <PageHeader title="Reports" />
      <Placeholder title={"No reports yet"} hint={"Attendance, collection and dues reports, all exportable."} action={"Export CSV"} />
    </Gate>
  );
}
