import { LOCKED, type LockedActivity } from "@/modules/billing/access";

// A paused module, or one waiting for payment, at the top of every page
// (agreed 2026-09-30): why, for those who see Bravitar's bills; whom to ask,
// for everyone else.
export function BillingNotice({ items, seesBills }: { items: LockedActivity[]; seesBills: boolean }) {
  if (!items.length) return null;
  return (
    <div role="status" className="mb-4 flex flex-col gap-1 rounded-lg bg-warning-600/10 px-3 py-2 text-label text-warning-600">
      {items.map((p) => (
        <p key={`${p.branch}|${p.activity}`}>
          {p.activity} at {p.branch} {seesBills ? LOCKED[p.status] : "is unavailable. Please contact your academy administrator."}
        </p>
      ))}
    </div>
  );
}
