// The only place money or counts are turned into text (docs/07 §2). Paise in,
// Indian grouping out: 14250050n -> ₹1,42,500.50, 14250000n -> ₹1,42,500.
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const count = new Intl.NumberFormat("en-IN");

export function formatPaise(paise: bigint, opts: { showPaise?: boolean } = {}): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const rest = Number(abs % 100n);
  const showPaise = opts.showPaise ?? rest !== 0;
  const body = inr.format(rupees) + (showPaise ? `.${String(rest).padStart(2, "0")}` : "");
  return `${negative ? "-" : ""}₹${body}`;
}

export function formatCount(n: number | bigint): string {
  return count.format(n);
}
