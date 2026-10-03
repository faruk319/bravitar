// What family members who aren't a student's manager see in the portal
// (agreed 2026-10-03); the manager always sees everything. No database
// imports: the Settings form uses these too.
export const FAMILY_ACCESS = ["attendance", "fees", "receipts", "pay"] as const;
export type FamilyAccess = (typeof FAMILY_ACCESS)[number];

export const FAMILY_ACCESS_LABELS: Record<FamilyAccess, string> = {
  attendance: "Attendance",
  fees: "Fees and dues",
  receipts: "Receipts",
  pay: "Pay online",
};
