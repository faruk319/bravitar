import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="fee_plans:manage">
      <PageTitle>{"Fee plans"}</PageTitle>
      <Placeholder title={"No fee plans yet"} hint={"Monthly, quarterly or term fees, with discounts."} action={"Add fee plan"} />
    </Gate>
  );
}
