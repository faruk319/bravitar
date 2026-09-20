import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type PublicTenant = { id: string; name: string; slug: string; status: string; verticalPreset: string };

// Subdomain → tenant, for the login page and public enquiry form. Runs before
// any tenant context exists, through the SECURITY DEFINER function only.
export async function resolveTenantBySlug(slug: string): Promise<PublicTenant | undefined> {
  const rows = await db.execute<{ id: string; name: string; slug: string; status: string; vertical_preset: string }>(
    sql`SELECT id, name, slug, status, vertical_preset FROM app.resolve_tenant_slug(${slug})`,
  );
  const r = rows[0];
  return r ? { id: r.id, name: r.name, slug: r.slug, status: r.status, verticalPreset: r.vertical_preset } : undefined;
}
