import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { numberSeries } from "./schema";

export const numberingFixtures: IsolationFixtures = {
  number_series: (tx, tenantId) => tx.insert(numberSeries).values({ tenantId, kind: "invoice", fy: "2099-00", prefix: "INV/2099-00/" }),
};
