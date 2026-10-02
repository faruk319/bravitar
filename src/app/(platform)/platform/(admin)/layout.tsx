import Link from "next/link";
import { SignOutButton } from "@/components/shell/sign-out";
import { requirePlatformPage } from "@/lib/auth/server";

// /platform, on the main site only (Prompt 21).
export default async function PlatformLayout({ children }: LayoutProps<"/platform">) {
  const s = await requirePlatformPage();
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-neutral-100 bg-card">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-4">
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
            <Link href="/platform" className="text-heading text-neutral-900">
              Bravitar platform
            </Link>
            <Link href="/platform" className="text-label text-neutral-700 hover:text-neutral-900">
              Academies
            </Link>
            <Link href="/platform/modules" className="text-label text-neutral-700 hover:text-neutral-900">
              Modules & pricing
            </Link>
            <Link href="/platform/subscriptions" className="text-label text-neutral-700 hover:text-neutral-900">
              Subscriptions
            </Link>
            <Link href="/platform/billing" className="text-label text-neutral-700 hover:text-neutral-900">
              Billing
            </Link>
            <Link href="/platform/queues" className="text-label text-neutral-700 hover:text-neutral-900">
              Queues
            </Link>
          </nav>
          <span className="flex items-center gap-2 text-label text-muted-foreground">
            {s.actor.name}
            <SignOutButton variant="ghost" to="/platform/login" />
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl p-4 md:p-6">{children}</main>
    </div>
  );
}
