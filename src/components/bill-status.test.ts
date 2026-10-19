import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillStatus } from "./bill-status";

const render = (bill: { status: "open" | "paid" | "void"; dueOn: string; paidPaise: bigint }, today = "2026-10-20") =>
  renderToStaticMarkup(createElement(BillStatus, { bill, today })).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// Bravitar's own bills share the invoice pill but keep their own words.
describe("a Bravitar bill's status", () => {
  it("a void bill still reads Void, never Cancelled", () => {
    expect(render({ status: "void", dueOn: "2026-11-08", paidPaise: 0n })).toBe("○ Void");
  });

  it("paid, overdue and part paid read as they did", () => {
    expect(render({ status: "paid", dueOn: "2026-10-08", paidPaise: 39900n })).toBe("✓ Paid");
    expect(render({ status: "open", dueOn: "2026-10-08", paidPaise: 0n })).toBe("! Overdue");
    expect(render({ status: "open", dueOn: "2026-11-08", paidPaise: 10000n })).toBe("◐ Part paid");
  });

  it("an open bill not yet due says when", () => {
    expect(render({ status: "open", dueOn: "2026-11-08", paidPaise: 0n })).toBe("Due 8 Nov");
  });
});
