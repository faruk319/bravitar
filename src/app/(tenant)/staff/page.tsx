import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="staff:read">
      <PageHeader title="{staff.many}" />
      <Placeholder title={"Just you so far"} hint={"Invite the people who run classes and the front desk."} action={"Invite {staff.one}"} />
    </Gate>
  );
}
