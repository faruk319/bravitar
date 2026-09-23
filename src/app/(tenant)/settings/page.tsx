import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="settings:manage">
      <PageHeader title="Settings" />
      <Placeholder title={"Academy settings"} hint={"Name, branches, labels and integrations."} action={"Edit academy"} />
    </Gate>
  );
}
