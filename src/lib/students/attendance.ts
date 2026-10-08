// Whole-number attendance; null when nothing was marked, so "No classes" never reads as "0%".
export function attendancePct(t: { attended: number; marked: number } | undefined): number | null {
  if (!t || t.marked <= 0) return null;
  return Math.round((t.attended / t.marked) * 100);
}
