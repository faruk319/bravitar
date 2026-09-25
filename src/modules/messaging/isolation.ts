import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { messageLog, messageTemplates, shareLinks } from "./schema";

export const messagingFixtures: IsolationFixtures = {
  share_links: (tx, tenantId) => tx.insert(shareLinks).values({ tenantId, kind: "invoice", entityId: uuidv7(), tokenHash: `iso-${uuidv7()}` }),
  message_templates: (tx, tenantId) => tx.insert(messageTemplates).values({ tenantId, key: "welcome", language: "en", body: "Iso welcome {{student_name}}" }),
  message_log: (tx, tenantId) => tx.insert(messageLog).values({ tenantId, toPhone: "+919800000000", channel: "manual", templateKey: "welcome", category: "welcome", language: "en", body: "Iso" }),
};
