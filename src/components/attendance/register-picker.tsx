"use client";

import { useRouter } from "next/navigation";

const control = "h-12 rounded-lg border border-input bg-background px-3 text-body";

// Batch and month for the register; the page is rendered from the URL.
export function RegisterPicker({ batches, batchId, month }: { batches: { id: string; label: string }[]; batchId: string; month: string }) {
  const router = useRouter();
  const go = (b: string, m: string) => router.replace(`/attendance?batch=${b}&month=${m}`);
  return (
    <div className="flex flex-wrap gap-2">
      <select aria-label="Batch" value={batchId} onChange={(e) => go(e.target.value, month)} className={control}>
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
      <input aria-label="Month" type="month" value={month} onChange={(e) => e.target.value && go(batchId, e.target.value)} className={control} />
    </div>
  );
}
