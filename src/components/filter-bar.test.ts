import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let url = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }), useSearchParams: () => new URLSearchParams(url) }));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, ...p }: { children: React.ReactNode; href: string }) => h("a", p, children) };
});

const { FilterBar, nextHref } = await import("./filter-bar");
const { StudentSearchBar } = await import("./students/search-bar");

const labels = (html: string) => [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
const option = (id: string) => ({ id, name: id });
const render = (at: string, node: React.ReactElement) => {
  url = at;
  return renderToStaticMarkup(node);
};

describe("the students filter bar, now a FilterBar", () => {
  const all = { options: { programs: [option("p")], batches: [option("b")], coaches: [option("c")] }, fee: true };

  it("keeps its controls and their order, and its placeholder", () => {
    const html = render("", createElement(StudentSearchBar, all));
    expect(labels(html)).toEqual(["Search", "Program", "Batch", "Coach", "Status", "Fee status", "Joined from", "Joined to"]);
    expect(html).toContain('placeholder="Name or phone"');
    expect(html).toContain("All statuses");
    expect(html).toContain("All fees");
  });

  it("leaves out what the viewer may not use", () => {
    expect(labels(render("", createElement(StudentSearchBar, { options: {}, fee: false })))).toEqual(["Search", "Status", "Joined from", "Joined to"]);
  });

  it("offers Clear filters only while one is set, and clearing goes back to /students", () => {
    expect(render("", createElement(StudentSearchBar, all))).not.toContain("Clear filters");
    expect(render("page=2", createElement(StudentSearchBar, all))).not.toContain("Clear filters");
    const html = render("q=Riya&status=active&page=2", createElement(StudentSearchBar, all));
    expect(html).toContain("Clear filters");
    expect(html).toContain('href="/students"');
  });
});

describe("a filter bar with a sort", () => {
  const sorts = [
    { value: "newest", label: "Newest first" },
    { value: "amount", label: "Highest amount" },
  ];
  const bar = createElement(FilterBar, { path: "/finance/invoices", search: { placeholder: "Invoice" }, selects: [{ name: "program", label: "Program", all: "All programs", options: [option("p")] }], dates: [{ name: "dueFrom", label: "Due from" }], sorts });

  it("shows the sort beside the search, on the first option unless the URL says otherwise", () => {
    expect(labels(render("", bar))).toEqual(["Search", "Sort", "Program", "Due from"]);
    expect(render("", bar)).toMatch(/<option value="newest" selected/);
    expect(render("sort=amount", bar)).toMatch(/<option value="amount" selected/);
  });

  it("has no sort unless asked", () => {
    const plain = createElement(FilterBar, { path: "/x", search: { placeholder: "Find" }, selects: [], dates: [] });
    expect(labels(render("", plain))).toEqual(["Search"]);
  });

  it("Clear filters drops the bar's filters and the page, and keeps the tab and the sort", () => {
    const html = render("status=overdue&q=Riya&program=p&dueFrom=2026-10-01&sort=amount&page=3", bar);
    expect(html).toContain('href="/finance/invoices?status=overdue&amp;sort=amount"');
    // With only the tab in the URL there is nothing to clear.
    expect(render("status=overdue&sort=amount", bar)).not.toContain("Clear filters");
  });

  it("clearing the last filter with nothing else in the URL goes to the bare path", () => {
    expect(render("q=Riya", bar)).toContain('href="/finance/invoices"');
  });
});

describe("the address after the bar changes", () => {
  it("sets what is given, drops what is empty, and goes back to page 1", () => {
    expect(nextHref("/x", "q=Riya&page=3", { method: "upi" })).toBe("/x?q=Riya&method=upi");
    expect(nextHref("/x", "q=Riya&method=upi", { method: "" })).toBe("/x?q=Riya");
  });

  it("is the bare path, with no dangling ?, when the last param goes", () => {
    expect(nextHref("/x", "q=Riya", { q: "" })).toBe("/x");
    expect(nextHref("/x", "page=2", { q: "" })).toBe("/x");
  });
});
