import { describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { invoiceParams, parseInvoiceQuery } from "./invoice-query";

describe("the invoice list's URL", () => {
  const programId = uuidv7();
  const batchId = uuidv7();

  it("starts on All, newest first, page 1", () => expect(parseInvoiceQuery({})).toEqual({ status: "all", sort: "newest", page: 1 }));

  it("drops a value that is not valid, so a stale link still loads", () => {
    const stale = { status: "unpaid", sort: "price", program: "x", batch: ["a", "b"], issuedFrom: "yesterday", dueFrom: "2026-02-30", q: "  ", page: "0" };
    expect(parseInvoiceQuery(stale)).toEqual({ status: "all", sort: "newest", page: 1 });
  });

  it("reads every filter, and the Open link's status", () => {
    expect(parseInvoiceQuery({ status: "open", q: " Riya ", program: programId, batch: batchId, dueFrom: "2026-10-20", dueTo: "2026-10-20", page: "2" })).toEqual({
      status: "open",
      q: "Riya",
      programId,
      batchId,
      dueFrom: "2026-10-20",
      dueTo: "2026-10-20",
      sort: "newest",
      page: 2,
    });
  });

  it("round-trips through the URL, with the names the page and the filter bar share", () => {
    const q = { status: "overdue", q: "Mother 7", programId, batchId, issuedFrom: "2026-10-01", issuedTo: "2026-10-31", dueFrom: "2026-10-05", dueTo: "2026-10-09", sort: "due" } as const;
    const params = invoiceParams(q, 3);
    expect([...params.keys()]).toEqual(["status", "q", "program", "batch", "issuedFrom", "issuedTo", "dueFrom", "dueTo", "sort", "page"]);
    expect(parseInvoiceQuery(Object.fromEntries(params))).toEqual({ ...q, page: 3 });
  });

  it("leaves out what is the default", () => {
    expect(invoiceParams({ status: "all", sort: "newest" }).toString()).toBe("");
    expect(invoiceParams({ status: "open", sort: "newest" }, 1).toString()).toBe("status=open");
  });
});
