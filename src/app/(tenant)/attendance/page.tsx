import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="attendance:read">
      <PageTitle>{"Attendance"}</PageTitle>
      <Placeholder title={"No attendance yet"} hint={"Marks show here once a {session.one} has been taken."} action={"Mark attendance"} />
    </Gate>
  );
}
