import { Button } from "@/components/ui/button";
import { RELATION_LABELS } from "@/modules/students/relations";
import type { KnownGuardian } from "@/modules/students/service";

// One line saying who a known number is. Names only for members the viewer may see; the rest are a count.
export function knownLine(k: KnownGuardian): string {
  if (!k.guardianId) return "This number is used at another branch.";
  const of = k.members.map((m) => (m.relation === "self" ? `is ${m.fullName}` : `${RELATION_LABELS[m.relation].toLowerCase()} of ${m.fullName}`)).join(", ");
  const rest = k.hidden ? `${of ? " + " : " "}${k.hidden} at other branches` : "";
  return `This number belongs to ${k.fullName}${of || rest ? ` (${of}${rest})` : ""}.`;
}

// Same person, or another number. Not offered when nothing about them may be shown.
export function KnownGuardianChoice({ known, linked, onLink, onOther }: { known: KnownGuardian; linked: boolean; onLink: () => void; onOther?: () => void }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-3">
      <p className="text-body">{knownLine(known)}</p>
      <div className="mt-3 flex gap-2">
        {known.guardianId ? (
          <Button type="button" size="sm" variant={linked ? "default" : "outline"} onClick={onLink}>
            {linked ? "Linked, undo" : "Same person, link"}
          </Button>
        ) : null}
        {onOther ? (
          <Button type="button" size="sm" variant="outline" onClick={onOther}>
            Use another number
          </Button>
        ) : null}
      </div>
    </div>
  );
}
