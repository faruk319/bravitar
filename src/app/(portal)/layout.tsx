import Link from "next/link";
import { AcademyMenu } from "@/components/shell/academy-menu";
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
            <AcademyMenu academies={others} action="/portal/switch" />
            <SignOutButton variant="ghost" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl p-4 md:p-6">{children}</main>
    </div>
  );
}
