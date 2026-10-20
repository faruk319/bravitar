import Link from "next/link";
import { Button } from "@/components/ui/button";

// "1–10 of 142" with Previous and Next, under a list in a card. `shown` is the rows on this page.
export function PagingFooter({ page, pageSize, shown, matched, href }: { page: number; pageSize: number; shown: number; matched: number; href: (page: number) => string }) {
  const first = (page - 1) * pageSize + 1;
  const last = first + shown - 1;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3 text-caption text-muted-foreground md:px-5">
      <span className="tabular-nums">
        {first}–{last} of {matched}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(page - 1)} />}>
            Previous
          </Button>
        ) : null}
        {last < matched ? (
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(page + 1)} />}>
            Next
          </Button>
        ) : null}
      </span>
    </div>
  );
}
