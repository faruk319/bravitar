import { sql } from "drizzle-orm";
import { hashToken, newToken } from "@/lib/auth/token";
import { writeAudit } from "@/lib/db/audit";
import { db, type Tx } from "@/lib/db/client";
import { uuidv7 } from "@/lib/ids";
import type { Actor } from "@/modules/fees/invoicing";
import { type ShareKind, shareLinks } from "./schema";

export const sharePath = (kind: ShareKind, token: string) => `/${kind === "invoice" ? "i" : "r"}/${token}`;

// A fresh private link per message (agreed 2026-09-25); the raw token lives only
// in the message, the database keeps its hash.
export async function makeShareLink(tx: Tx, actor: Actor, kind: ShareKind, entityId: string): Promise<string> {
  const token = newToken();
  const createdBy = actor.actorType === "staff" ? (actor.actorId ?? null) : null; // staff only; a parent's is in the audit
  await tx.insert(shareLinks).values({ id: uuidv7(), tenantId: actor.tenantId, kind, entityId, tokenHash: hashToken(token), createdBy });
  await writeAudit(tx, { ...actor, action: "share_link.create", entityType: kind, entityId });
  return token;
}

export type Shared = { tenantId: string; kind: ShareKind; entityId: string };

// Public pages have no tenant yet: the SECURITY DEFINER lookup finds it by hash.
export async function resolveShareLink(token: string): Promise<Shared | undefined> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
  const [row] = await db.execute<{ tenant_id: string; kind: ShareKind; entity_id: string }>(sql`SELECT * FROM app.share_link_by_token_hash(${hashToken(token)})`);
  return row ? { tenantId: row.tenant_id, kind: row.kind, entityId: row.entity_id } : undefined;
}
