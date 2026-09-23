import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { todayIn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { type Branch, branches, type Resource, resources, type Tenant, tenants } from "./schema";

// Tenant-scoped functions take a Tx from withTenant() and never a tenant id
// for reads: the context is on the transaction, and RLS does the filtering.

export type CreateTenantInput = { name: string; slug: string; verticalPreset?: string; timezone?: string; codePrefix?: string };

export async function createTenant(tx: PlatformTx, input: CreateTenantInput): Promise<Tenant> {
  const [row] = await tx.insert(tenants).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("tenant insert returned no row");
  return row;
}

export async function findTenantBySlug(tx: PlatformTx, slug: string): Promise<Tenant | undefined> {
  const [row] = await tx.select().from(tenants).where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)));
  return row;
}

export async function tenantToday(tx: Tx): Promise<string> {
  return todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata");
}

export async function getOwnTenant(tx: Tx): Promise<Tenant | undefined> {
  const [row] = await tx.select().from(tenants).where(isNull(tenants.deletedAt)).limit(1);
  return row;
}

export type CreateBranchInput = { tenantId: string; name: string; address?: string; phone?: string; isDefault?: boolean };

export async function createBranch(tx: Tx | PlatformTx, input: CreateBranchInput): Promise<Branch> {
  const [row] = await tx.insert(branches).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("branch insert returned no row");
  return row;
}

export async function listBranches(tx: Tx): Promise<Branch[]> {
  return tx.select().from(branches).where(isNull(branches.deletedAt)).orderBy(branches.name);
}

export async function getDefaultBranch(tx: Tx): Promise<Branch | undefined> {
  const [row] = await tx.select().from(branches).where(and(eq(branches.isDefault, true), isNull(branches.deletedAt)));
  return row;
}

export async function getBranch(tx: Tx, id: string): Promise<Branch | undefined> {
  const [row] = await tx.select().from(branches).where(and(eq(branches.id, id), isNull(branches.deletedAt)));
  return row;
}

export type CreateResourceInput = { tenantId: string; branchId: string; name: string; capacity?: number };

export async function createResource(tx: Tx | PlatformTx, input: CreateResourceInput): Promise<Resource> {
  const [row] = await tx.insert(resources).values({ id: uuidv7(), ...input }).returning();
  if (!row) throw new Error("resource insert returned no row");
  return row;
}

export async function listResources(tx: Tx, branchId?: string): Promise<Resource[]> {
  const where = branchId ? and(isNull(resources.deletedAt), eq(resources.branchId, branchId)) : isNull(resources.deletedAt);
  return tx.select().from(resources).where(where).orderBy(resources.name);
}
