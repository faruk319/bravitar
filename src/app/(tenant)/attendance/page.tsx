import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="attendance:read">
      <PageHeader title="Attendance" />
      <Placeholder title={"No attendance yet"} hint={"Marks show here once a {session.one} has been taken."} action={"Mark attendance"} />
    </Gate>
  );
}
