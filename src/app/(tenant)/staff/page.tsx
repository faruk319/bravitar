import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="staff:read">
      <PageTitle>{"{staff.many}"}</PageTitle>
      <Placeholder title={"Just you so far"} hint={"Invite the people who run classes and the front desk."} action={"Invite {staff.one}"} />
    </Gate>
  );
}
