import { FilterBar, type Option } from "@/components/filter-bar";
import type { StudentList } from "@/modules/students/service";

const STATUSES: Option[] = [
  { id: "active", name: "Active" },
  { id: "paused", name: "Paused" },
  { id: "left", name: "Left" },
];
const FEES: Option[] = [
  { id: "paid", name: "Paid" },
  { id: "due", name: "Due" },
  { id: "overdue", name: "Overdue" },
];

export function StudentSearchBar({ options, fee }: { options: StudentList["options"]; fee: boolean }) {
  const selects = [
    ...(options.programs ? [{ name: "program", label: "Program", all: "All programs", options: options.programs }] : []),
    ...(options.batches ? [{ name: "batch", label: "Batch", all: "All batches", options: options.batches }] : []),
    ...(options.coaches ? [{ name: "coach", label: "Coach", all: "All coaches", options: options.coaches }] : []),
    { name: "status", label: "Status", all: "All statuses", options: STATUSES },
    ...(fee ? [{ name: "fee", label: "Fee status", all: "All fees", options: FEES }] : []),
  ];
  return <FilterBar path="/students" search={{ placeholder: "Name or phone" }} selects={selects} dates={[{ name: "joinedFrom", label: "Joined from" }, { name: "joinedTo", label: "Joined to" }]} />;
}
