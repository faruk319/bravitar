import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="sessions:read">
      <PageTitle>{"Today's {session.many}"}</PageTitle>
      <Placeholder title={"No {session.many} today"} hint={"{session.many} appear once a {batch.one} has a weekly schedule."} action={"Add {batch.one}"} />
    </Gate>
  );
}
