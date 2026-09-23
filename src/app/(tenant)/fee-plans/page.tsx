import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="fee_plans:manage">
      <PageHeader title="Fee plans" />
      <Placeholder title={"No fee plans yet"} hint={"Monthly, quarterly or term fees, with discounts."} action={"Add fee plan"} />
    </Gate>
  );
}
