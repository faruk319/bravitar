// Who someone is to a student (agreed 2026-10-03). "self" is an adult
// student's own record. No database imports: forms use these too.
export const FAMILY_RELATIONS = ["father", "mother", "brother", "sister", "grandparent", "spouse", "guardian", "cousin", "friend", "other"] as const;
export const RELATIONS = [...FAMILY_RELATIONS, "self"] as const;
export type Relation = (typeof RELATIONS)[number];
export type FamilyRelation = (typeof FAMILY_RELATIONS)[number];

export const RELATION_LABELS: Record<Relation, string> = {
  father: "Father",
  mother: "Mother",
  brother: "Brother",
  sister: "Sister",
  grandparent: "Grandparent",
  spouse: "Spouse",
  guardian: "Guardian",
  cousin: "Cousin",
  friend: "Friend",
  other: "Other",
  self: "Self",
};
