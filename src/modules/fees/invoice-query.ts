import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
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

// A value that is not valid is dropped, so a stale link still loads.
export function parseInvoiceQuery(sp: Record<string, string | string[] | undefined>): InvoiceQuery {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const id = (k: string) => {
    const v = one(k);
    return v && z.uuid().safeParse(v).success ? v : undefined;
  };
  const day = (k: string) => {
    const v = one(k);
    return v && isIsoDate(v) ? v : undefined;
  };
  const [status, sort] = [one("status"), one("sort")];
  const out: InvoiceQuery = {
    status: status && ([...DISPLAY_STATUSES, "all", "open"] as readonly string[]).includes(status) ? (status as InvoiceStatusFilter) : "all",
    sort: sort && (INVOICE_SORTS as readonly string[]).includes(sort) ? (sort as InvoiceSort) : "newest",
    page: Math.max(1, Math.floor(Number(one("page"))) || 1),
  };
  const q = one("q");
  if (q) out.q = q;
  for (const [k, v] of [["programId", id("program")], ["batchId", id("batch")], ["issuedFrom", day("issuedFrom")], ["issuedTo", day("issuedTo")], ["dueFrom", day("dueFrom")], ["dueTo", day("dueTo")]] as const) if (v) out[k] = v;
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
