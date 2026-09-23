import { cn } from "@/lib/utils";

// Initials for now; photos come later, and only with consent (docs/03 §3).
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-accent-50 font-medium text-accent-600",
        size === "sm" && "size-8 text-caption",
        size === "md" && "size-10 text-label",
        size === "lg" && "size-20 text-display",
      )}
    >
      {initials}
    </span>
  );
}
