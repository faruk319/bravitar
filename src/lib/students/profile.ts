import { type Relation, RELATION_LABELS } from "@/modules/students/relations";

type Contact = { relation: Relation; email: string | null };

// Students have no email of their own: show each guardian's, saying whose it is.
export function emailRows(guardians: Contact[]): { label: string; value: string }[] {
  return guardians.flatMap((g) => (g.email ? [{ label: `Email (${RELATION_LABELS[g.relation].toLowerCase()})`, value: g.email }] : []));
}
