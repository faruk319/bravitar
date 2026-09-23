import { SegmentedTabs } from "@/components/segmented-tabs";

export function StaffTabs({ active }: { active: "staff" | "roles" }) {
  return (
    <SegmentedTabs
      label="Sections"
      items={[
        { href: "/staff", label: "Staff", active: active === "staff" },
        { href: "/staff/roles", label: "Roles", active: active === "roles" },
      ]}
    />
  );
}
