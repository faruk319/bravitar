import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// docs/07 §6: one line explaining, one button creating the first item. Until
// the button's feature exists it is rendered disabled with a short caption.
type Props = { title: string; hint: string; action: string; onAction?: () => void; href?: string; icon?: ReactNode; soon?: boolean };

export function EmptyState({ title, hint, action, onAction, href, icon, soon }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon ? <div className="text-neutral-300 [&_svg]:size-10">{icon}</div> : null}
      <h2 className="text-heading">{title}</h2>
      <p className="max-w-xs text-body text-muted-foreground">{hint}</p>
      <div className="mt-3 flex flex-col items-center gap-1">
        {href && !soon ? (
          <Button size="lg" render={<a href={href} />}>
            {action}
          </Button>
        ) : (
          <Button size="lg" onClick={onAction} disabled={soon || !onAction}>
            {action}
          </Button>
        )}
        {soon ? <span className="text-caption text-muted-foreground">Soon</span> : null}
      </div>
    </div>
  );
}
