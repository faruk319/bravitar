import type { Tx } from "@/lib/db/client";

// Inserts at least one row for the given tenant into one tenant-scoped table.
export type IsolationFixture = (tx: Tx, tenantId: string) => Promise<unknown>;

export type IsolationFixtures = Record<string, IsolationFixture>;
