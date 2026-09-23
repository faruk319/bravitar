import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="sessions:read">
      <PageHeader title="Today's {session.many}" />
      <Placeholder title={"No {session.many} today"} hint={"{session.many} appear once a {batch.one} has a weekly schedule."} action={"Add {batch.one}"} />
    </Gate>
  );
}
