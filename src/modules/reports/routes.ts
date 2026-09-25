import { pathSegment, type ScopedCtx, scopedCtx, withStaffRequest } from "@/lib/auth/route";
import { selectedBranchIds } from "@/lib/auth/server";
import { toCsv } from "@/lib/csv";
import type { Tx } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { admissionsRows, collectionRows, duesRows } from "./csv";
import { admissionsReport, collectionRegister, outstandingDues, type Range, thisMonth } from "./service";

type Csv = { rows: string[][]; stamp: string };
const span = (r: Range) => `${r.from}-to-${r.to}`;

const CSV: Record<string, (tx: Tx, ctx: ScopedCtx, range: Range) => Promise<Csv>> = {
  collection: async (tx, ctx, range) => ({ rows: collectionRows(await collectionRegister(tx, ctx, range)), stamp: span(range) }),
  dues: async (tx, ctx) => {
    const r = await outstandingDues(tx, ctx);
    return { rows: duesRows(r), stamp: r.asOf };
  },
  admissions: async (tx, ctx, range) => ({ rows: admissionsRows(await admissionsReport(tx, ctx, range)), stamp: span(range) }),
};

// GET /api/reports/<name>?from=&to= : the report as a CSV download, UTF-8 with
// a BOM so Devanagari names open in Excel; text Excel would run is defused.
export const csvRoute = withStaffRequest("reports:view", async (r) => {
  const name = pathSegment(r.req, 2);
  const build = Object.hasOwn(CSV, name) ? CSV[name] : undefined;
  if (!build) throw new NotFoundError("Report");
  const q = new URL(r.req.url).searchParams;
  const range = { ...(await thisMonth(r.tx)), ...(q.get("from") ? { from: q.get("from") ?? "" } : {}), ...(q.get("to") ? { to: q.get("to") ?? "" } : {}) };
  // The branch switcher's choice, as on the report's page.
  const { rows, stamp } = await build(r.tx, { ...scopedCtx(r.session, r.req), branchIds: await selectedBranchIds(r.session) }, range);
  return new Response(toCsv(rows, { formulaSafe: true }), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-${stamp}.csv"`, "cache-control": "no-store" },
  });
});
