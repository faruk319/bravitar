import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { tenantIntegrations, webhookEvents } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 10);

export const integrationFixtures: IsolationFixtures = {
  // Opaque bytes are enough: RLS never looks inside.
  tenant_integrations: (tx, tenantId) => tx.insert(tenantIntegrations).values({ id: uuidv7(), tenantId, kind: "razorpay", credentials: Buffer.from("sealed"), config: { keyId: "rzp_test_iso", mode: "test" } }),
  webhook_events: (tx, tenantId) => tx.insert(webhookEvents).values({ id: uuidv7(), tenantId, provider: "razorpay", providerEventId: `evt_${stamp()}`, event: "test", payload: {} }),
};
