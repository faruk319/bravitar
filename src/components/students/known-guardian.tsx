import { Button } from "@/components/ui/button";
import type { KnownGuardian } from "@/modules/students/service";
import { knownLine } from "./known-line";

// Same person, or another number. Not offered when nothing about them may be shown.
export function KnownGuardianChoice({ known, linked, onLink, onOther }: { known: KnownGuardian; linked: boolean; onLink: () => void; onOther?: () => void }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-3">
      <p className="text-body">{knownLine(known)}{known.guardianId || onOther ? "" : " Ask an owner."}</p>
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
