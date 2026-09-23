import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="fees:collect">
      <PageHeader title="Collect payment" />
      <Placeholder title={"Nothing to collect yet"} hint={"Record cash, UPI, bank or cheque payments here."} action={"Record payment"} />
    </Gate>
  );
}
