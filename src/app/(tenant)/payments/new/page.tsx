import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="fees:collect">
      <PageTitle>{"Collect payment"}</PageTitle>
      <Placeholder title={"Nothing to collect yet"} hint={"Record cash, UPI, bank or cheque payments here."} action={"Record payment"} />
    </Gate>
  );
}
