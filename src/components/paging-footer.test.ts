import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ children, ...p }: { children: React.ReactNode; href: string }) => h("a", p, children) };
});

const { PagingFooter } = await import("./paging-footer");

const render = (page: number, shown: number, matched: number) =>
  renderToStaticMarkup(createElement(PagingFooter, { page, pageSize: 10, shown, matched, href: (p) => `/list?page=${p}` }));

describe("the paging footer", () => {
  it("counts the rows on the page, and offers only Next on the first page", () => {
    const html = render(1, 10, 25);
    expect(html).toContain("1–10 of 25");
    expect(html).toContain('href="/list?page=2"');
    expect(html).not.toContain("Previous");
  });

  it("offers both in the middle, and only Previous on the last page", () => {
    const middle = render(2, 10, 25);
    expect(middle).toContain("11–20 of 25");
    expect([middle.includes('href="/list?page=1"'), middle.includes('href="/list?page=3"')]).toEqual([true, true]);
    const last = render(3, 5, 25);
    expect(last).toContain("21–25 of 25");
    expect(last).toContain("Previous");
    expect(last).not.toContain("Next");
  });
});
