// Financial year label for a local date: "2026-09-24" → "2026-27" (April start).
// A January start is a plain calendar year: "2026".
export function financialYear(date: string, startMonth = 4): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= startMonth ? y : y - 1;
  return startMonth === 1 ? String(start) : `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
