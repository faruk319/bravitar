import { asc, isNull } from "drizzle-orm";
import { Card } from "@/components/ui/card";
import { requirePlatformPage } from "@/lib/auth/server";
import { platformRead } from "@/lib/db/platform";
import { tenants } from "@/modules/tenancy/schema";

// Every academy (Prompt 21); usage against the plan comes next.
export default async function PlatformHome() {
  await requirePlatformPage();
  const rows = await platformRead((tx) => tx.select({ id: tenants.id, name: tenants.name, slug: tenants.slug, type: tenants.verticalPreset, status: tenants.status }).from(tenants).where(isNull(tenants.deletedAt)).orderBy(asc(tenants.name)));
  return (
    <>
      <h1 className="mb-4 text-display">Academies</h1>
      <Card className="p-0 md:p-0">
        <ul className="divide-y divide-neutral-100">
          {rows.map((t) => (
            <li key={t.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
              <span>
                <span className="block text-body font-medium text-neutral-900">{t.name}</span>
                <span className="block text-caption text-muted-foreground">
                  {t.slug} · {t.type}
                </span>
              </span>
              <span className="text-label">{t.status}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
