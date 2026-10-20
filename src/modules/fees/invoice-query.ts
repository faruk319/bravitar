import { queryReader, type SearchParams } from "@/lib/url-query";
import { DISPLAY_STATUSES, type DisplayStatus } from "./billing";

// The invoice list's query, as it travels in the URL.

// `open` is issued or part paid on any due date: for links (the dashboard's Fees due), not a tab.
export type InvoiceStatusFilter = DisplayStatus | "all" | "open";
export const INVOICE_SORTS = ["newest", "oldest", "amount", "due"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

export type InvoiceQuery = {
  status: InvoiceStatusFilter;
  q?: string;
  programId?: string;
  batchId?: string;
  issuedFrom?: string;
  issuedTo?: string;
  dueFrom?: string;
  dueTo?: string;
  sort: InvoiceSort;
  page: number;
};

export function parseInvoiceQuery(sp: SearchParams): InvoiceQuery {
  const read = queryReader(sp);
  const out: InvoiceQuery = {
    status: read.oneOf("status", [...DISPLAY_STATUSES, "all", "open"] as const) ?? "all",
    sort: read.oneOf("sort", INVOICE_SORTS) ?? "newest",
    page: read.page(),
  };
  const q = read.one("q");
  if (q) out.q = q;
  for (const [k, v] of [["programId", read.id("program")], ["batchId", read.id("batch")], ["issuedFrom", read.day("issuedFrom")], ["issuedTo", read.day("issuedTo")], ["dueFrom", read.day("dueFrom")], ["dueTo", read.day("dueTo")]] as const) if (v) out[k] = v;
  return out;
}

// The inverse of parseInvoiceQuery, for links that keep the filters; what is the default stays out.
export function invoiceParams(q: Omit<InvoiceQuery, "page">, page?: number): URLSearchParams {
  const out = new URLSearchParams();
  if (q.status !== "all") out.set("status", q.status);
  for (const [k, name] of [["q", "q"], ["programId", "program"], ["batchId", "batch"], ["issuedFrom", "issuedFrom"], ["issuedTo", "issuedTo"], ["dueFrom", "dueFrom"], ["dueTo", "dueTo"]] as const) if (q[k]) out.set(name, q[k]);
  if (q.sort !== "newest") out.set("sort", q.sort);
  if (page && page > 1) out.set("page", String(page));
  return out;
}
