import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="messages:read">
      <PageTitle>{"Messages"}</PageTitle>
      <Placeholder title={"No messages yet"} hint={"Reminders, receipts and notices sent on WhatsApp."} action={"Send message"} />
    </Gate>
  );
}
