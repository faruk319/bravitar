import { joinNames } from "@/modules/messaging/templates";
import { RELATION_LABELS, type Relation } from "@/modules/students/relations";
import type { KnownGuardian } from "@/modules/students/service";

// "father of A and B", one phrase per relation; a member who is the guardian themselves reads "is A".
export function relationParts(members: KnownGuardian["members"]): string[] {
  const by = new Map<Relation, string[]>();
  for (const m of members) by.set(m.relation, [...(by.get(m.relation) ?? []), m.fullName]);
  return [...by].map(([relation, names]) => (relation === "self" ? `is ${joinNames(names)}` : `${RELATION_LABELS[relation].toLowerCase()} of ${joinNames(names)}`));
}

// One line saying who a known number is. Names only for members the viewer may see; the rest are a count.
export function knownLine(k: KnownGuardian): string {
  if (!k.guardianId) return "This number is used at another branch.";
  const of = relationParts(k.members).join(", ");
  const rest = k.hidden ? `${of ? " + " : " "}${k.hidden} at other branches` : "";
  return `This number belongs to ${k.fullName}${of || rest ? ` (${of}${rest})` : ""}.`;
}
