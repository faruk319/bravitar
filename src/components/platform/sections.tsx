import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";

// The /platform overview pages: a titled list, and an academy's name linking to its page.
export function Section({ id, title, empty, children }: { id?: string; title: string; empty: boolean; children: ReactNode }) {
  return (
    <Card id={id}>
      <CardHeader title={title} />
      {empty ? <p className="text-body text-muted-foreground">None.</p> : <ul className="divide-y divide-neutral-100">{children}</ul>}
    </Card>
  );
}

export function AcademyLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/platform/academies/${id}`} className="font-medium text-neutral-900 hover:underline">
      {name}
    </Link>
  );
}
