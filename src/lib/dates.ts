// Display only. Storage is ISO / timestamptz.
const dmy = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(`${iso.length === 10 ? `${iso}T00:00:00Z` : iso}`) : iso;
  return Number.isNaN(d.getTime()) ? "—" : dmy.format(d);
}
