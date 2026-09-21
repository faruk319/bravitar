import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="settings:manage">
      <PageTitle>{"Settings"}</PageTitle>
      <Placeholder title={"Academy settings"} hint={"Name, branches, labels and integrations."} action={"Edit academy"} />
    </Gate>
  );
}
