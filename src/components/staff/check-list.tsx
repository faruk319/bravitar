import type { ReactNode } from "react";

export type Option = { id: string; label: string; hint?: string; disabled?: boolean };

// Checkboxes as 48px rows; the value is the ticked ids. actions sit beside the legend.
export function CheckList({ legend, options, value, onChange, actions }: { legend: string; options: Option[]; value: string[]; onChange: (ids: string[]) => void; actions?: ReactNode }) {
  return (
    <fieldset className="flex flex-col">
      {actions ? (
        <>
          <legend className="sr-only">{legend}</legend>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span aria-hidden className="text-label">
              {legend}
            </span>
            <span className="flex gap-1">{actions}</span>
          </div>
        </>
      ) : (
        <legend className="mb-1 text-label">{legend}</legend>
      )}
      {options.map((o) => (
        <label key={o.id} className="flex min-h-12 items-center gap-3 border-b border-neutral-100 last:border-b-0">
          <input
            type="checkbox"
            className="size-5 accent-accent-600"
            checked={value.includes(o.id)}
            disabled={o.disabled}
            onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((v) => v !== o.id))}
          />
          <span className="flex-1 text-body">
            {o.label}
            {o.hint ? <span className="block text-caption text-muted-foreground">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
