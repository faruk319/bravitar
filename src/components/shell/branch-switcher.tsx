"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBranch } from "./tenant-provider";

// Hidden entirely when there is nothing to switch between.
export function BranchSwitcher({ className }: { className?: string }) {
  const { branches, currentBranchId } = useBranch();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (branches.length < 2) return null;
  return (
    <select
      aria-label="Branch"
      value={currentBranchId}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        await fetch("/api/branch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId: e.target.value }) });
        setBusy(false);
        router.refresh();
      }}
      className={`h-12 rounded-lg border border-border bg-background px-3 text-body ${className ?? ""}`}
    >
      <option value="all">All branches</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
