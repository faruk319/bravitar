import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="invoices:read">
      <PageTitle>{"Invoices"}</PageTitle>
      <Placeholder title={"No invoices yet"} hint={"Invoices are generated from fee plans on the billing day."} action={"Add fee plan"} />
    </Gate>
  );
}
