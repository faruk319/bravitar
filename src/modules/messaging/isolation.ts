import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { shareLinks } from "./schema";

export const messagingFixtures: IsolationFixtures = {
  share_links: (tx, tenantId) => tx.insert(shareLinks).values({ tenantId, kind: "invoice", entityId: uuidv7(), tokenHash: `iso-${uuidv7()}` }),
};
