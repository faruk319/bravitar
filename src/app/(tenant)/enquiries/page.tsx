import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="enquiries:read">
      <PageTitle>{"Enquiries"}</PageTitle>
      <Placeholder title={"No enquiries yet"} hint={"Every call or walk-in goes here until they join."} action={"Add enquiry"} />
    </Gate>
  );
}
