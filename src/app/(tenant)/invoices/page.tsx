import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="invoices:read">
      <PageHeader title="Invoices" />
      <Placeholder title={"No invoices yet"} hint={"Invoices are generated from fee plans on the billing day."} action={"Add fee plan"} />
    </Gate>
  );
}
