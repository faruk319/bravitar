import { Gate } from "@/components/shell/gate";
import { PageTitle, Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Gate permission="batches:read">
      <PageTitle>{"Programs & {batch.many}"}</PageTitle>
      <Placeholder title={"No {batch.many} yet"} hint={"A {batch.one} is a group with a weekly timing."} action={"Add {batch.one}"} />
    </Gate>
  );
}
