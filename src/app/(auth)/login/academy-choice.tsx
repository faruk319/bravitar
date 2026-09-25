import { Button } from "@/components/ui/button";
import type { Academy } from "@/modules/auth/service";

// After the main site's sign-in or reset: one link per academy, each a
// one-time pass to that academy's own address.
export function AcademyChoice({ academies }: { academies: Academy[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-label">Choose academy</p>
      {academies.map((a) => (
        <Button key={a.url} variant="outline" size="lg" nativeButton={false} render={<a href={a.url} />}>
          {a.name}
        </Button>
      ))}
    </div>
  );
}
