import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/shell/sign-out";
import { requireGuardianPage } from "@/lib/auth/server";
import { otherAcademies } from "@/modules/auth/guardian";

// docs/07 §5: no navigation, one scrolling page per child. The header names
// the academy; "Switch academy" when this number is a parent elsewhere too.
export default async function PortalLayout({ children }: LayoutProps<"/">) {
  const session = await requireGuardianPage();
  const others = await otherAcademies(session.phone, session.tenant.id);
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-10 border-b border-neutral-100 bg-card">
        <div className="mx-auto flex min-h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/portal" className="min-w-0 truncate text-heading text-neutral-900">
            {session.tenant.name}
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            {others.length ? (
              <details className="relative">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-label text-neutral-700 hover:bg-neutral-50">
                  Switch academy <ChevronDown className="size-4" aria-hidden />
                </summary>
                <div className="absolute right-0 mt-1 w-64 rounded-xl border border-neutral-100 bg-card p-1 shadow-card">
                  {others.map((a) => (
                    <form key={a.slug} method="post" action="/portal/switch">
                      <input type="hidden" name="slug" value={a.slug} />
                      <button type="submit" className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-body hover:bg-neutral-50">
                        {a.name}
                      </button>
                    </form>
                  ))}
                </div>
              </details>
            ) : null}
            <SignOutButton variant="ghost" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl p-4 md:p-6">{children}</main>
    </div>
  );
}
