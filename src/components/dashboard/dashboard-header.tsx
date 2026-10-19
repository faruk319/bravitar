import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const greeting = (hour: number) => (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");

// `hour` is the tenant-local hour, computed by the page.
export function DashboardHeader({ name, hour, date, canAddStudent, canCollect }: { name: string; hour: number; date: string; canAddStudent: boolean; canCollect: boolean }) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-display">{`${greeting(hour)}${first ? `, ${first}` : ""} 👋`}</h1>
        <p className="text-caption text-muted-foreground">{date}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canAddStudent ? (
          <Button nativeButton={false} render={<Link href="/students/new" />} variant="outline" className="min-h-11">
            <Plus aria-hidden />
            Add student
          </Button>
        ) : null}
        {canCollect ? (
          <Button nativeButton={false} render={<Link href="/finance/collections/new" />} className="min-h-11">
            <Plus aria-hidden />
            Collect fee
          </Button>
        ) : null}
      </div>
    </div>
  );
}
