import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { type Branch, branches, type Tenant, tenants } from "./schema";

// Tenant-scoped functions take a Tx from withTenant() and never a tenant id:
// the context is on the transaction, and RLS does the filtering.

export type CreateTenantInput = { name: string; slug: string; verticalPreset?: string; timezone?: string };

export async function createTenant(tx: PlatformTx, input: CreateTenantInput): Promise<Tenant> {
  const [row] = await tx.insert(tenants).values(input).returning();
  if (!row) throw new Error("tenant insert returned no row");
  return row;
}

export async function getOwnTenant(tx: Tx): Promise<Tenant | undefined> {
  const [row] = await tx.select().from(tenants).where(isNull(tenants.deletedAt)).limit(1);
  return row;
}

export type CreateBranchInput = { tenantId: string; name: string; address?: string; phone?: string; isDefault?: boolean };

export async function createBranch(tx: Tx, input: CreateBranchInput): Promise<Branch> {
  const [row] = await tx.insert(branches).values(input).returning();
  if (!row) throw new Error("branch insert returned no row");
  return row;
}

export async function listBranches(tx: Tx): Promise<Branch[]> {
  return tx.select().from(branches).where(isNull(branches.deletedAt)).orderBy(branches.name);
}

export async function getBranch(tx: Tx, id: string): Promise<Branch | undefined> {
  const [row] = await tx.select().from(branches).where(and(eq(branches.id, id), isNull(branches.deletedAt)));
  return row;
}
