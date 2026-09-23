import { Gate } from "@/components/shell/gate";
import { PageHeader } from "@/components/page-header";
import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="messages:read">
      <PageHeader title="Messages" />
      <Placeholder title={"No messages yet"} hint={"Reminders, receipts and notices sent on WhatsApp."} action={"Send message"} />
    </Gate>
  );
}
