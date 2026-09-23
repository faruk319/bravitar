import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="enquiries:read">
      <PageHeader title="Enquiries" />
      <Placeholder title={"No enquiries yet"} hint={"Every call or walk-in goes here until they join."} action={"Add enquiry"} />
    </Gate>
  );
}
