import { ChevronDown } from "lucide-react";

export type AcademyChoice = { slug: string; name: string };

// "Switch academy": a parent's other academies on the portal (agreed
// 2026-09-25), a staff member's linked ones (agreed 2026-10-02). Each posts
// to action, which answers with the pass to that academy.
export function AcademyMenu({ academies, action }: { academies: AcademyChoice[]; action: string }) {
  if (!academies.length) return null;
  return (
    <details className="relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-label text-neutral-700 hover:bg-neutral-50">
        Switch<span className="hidden sm:inline"> academy</span> <ChevronDown className="size-4" aria-hidden />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-neutral-100 bg-card p-1 shadow-card">
        {academies.map((a) => (
          <form key={a.slug} method="post" action={action}>
            <input type="hidden" name="slug" value={a.slug} />
            <button type="submit" className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-body hover:bg-neutral-50">
              {a.name}
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}
