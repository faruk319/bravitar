import { integer, pgSchema, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@/modules/tenancy/schema";

// Mirrors migrations/0013_number_series.sql.
const app = pgSchema("app");

export const DOC_KINDS = ["invoice", "receipt"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const numberSeries = app.table(
  "number_series",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    kind: text("kind", { enum: DOC_KINDS }).notNull(),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.kind, t.fy] })],
);
