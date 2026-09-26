import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requirePlatformPage } from "@/lib/auth/server";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { listAcademies } from "@/modules/platform/academies";

const typeLabel = (t: string) => (t[0]?.toUpperCase() ?? "") + t.slice(1);

// Every academy: its branches, each on its own plan (agreed 2026-09-26), and
// the students against those plans (Prompt 21).
export default async function PlatformAcademies({ searchParams }: PageProps<"/platform">) {
  await requirePlatformPage();
  const q = (await searchParams).q;
  const rows = await listAcademies(typeof q === "string" ? q : undefined);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-display">Academies</h1>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get">
            <Input name="q" defaultValue={typeof q === "string" ? q : ""} placeholder="Name or address" className="w-56" />
          </form>
          <Button nativeButton={false} render={<Link href="/platform/academies/new" />}>
            New academy
          </Button>
        </div>
      </div>
      <Card className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[48rem] text-body">
          <thead>
            <tr className="bg-neutral-50 text-left text-caption uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Academy</th>
              <th className="py-2 font-medium">Branches and plans</th>
              <th className="py-2 font-medium">Students</th>
              <th className="py-2 font-medium">Staff</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-neutral-100">
                <td className="px-4 py-2">
                  <Link href={`/platform/academies/${a.id}`} className="font-medium text-neutral-900 hover:underline">
                    {a.name}
                  </Link>
                  <span className="block text-caption text-muted-foreground">
                    {a.slug} · {typeLabel(a.type)}
                  </span>
                </td>
                <td className="py-2">
                  {a.branches.length} {a.branches.length === 1 ? "branch" : "branches"} · {formatPaise(a.monthlyPaise)}/month
                  <span className="block text-caption text-muted-foreground">{a.branches.map((b) => b.plan?.name ?? "No plan").join(", ")}</span>
                </td>
                <td className={cn("py-2 tabular-nums", a.over && "text-danger-600")}>
                  {a.branches.reduce((n, b) => n + b.students, 0)}
                  {a.over ? " · over" : ""}
                </td>
                <td className="py-2 tabular-nums">{a.staff}</td>
                <td className={cn("px-4 py-2", a.status === "active" ? "text-success-600" : "text-danger-600")}>{a.status === "active" ? "● Active" : "⏸ Suspended"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length ? null : <p className="p-6 text-center text-body text-muted-foreground">No academy matches.</p>}
      </Card>
    </>
  );
}
